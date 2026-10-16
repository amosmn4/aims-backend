import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { hasResourceGrant } from "../common/has-resource-grant";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { PrismaService } from "../prisma/prisma.service";

export const LEDGER_RESOURCE = "payment-ledger";
export const LEDGER_MODULE_ID = "3dd32195-341a-4ba2-9ef1-05e37a076bdd";

@Injectable()
export class PaymentLedgerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async access(user: AuthenticatedUser) {
    if (isAdminOrCeo(user))
      return { read: true, write: !user.actorId, manageAccess: !user.actorId };
    const write =
      !user.actorId &&
      (await hasResourceGrant(LEDGER_RESOURCE, LEDGER_MODULE_ID, user, "write", this.prisma));
    const read =
      write ||
      (await hasResourceGrant(LEDGER_RESOURCE, LEDGER_MODULE_ID, user, "read", this.prisma));
    return { read, write, manageAccess: false };
  }

  async assert(user: AuthenticatedUser, action: "read" | "write" | "manageAccess" = "read") {
    if (!(await this.access(user))[action])
      throw new ForbiddenException("You do not have access to this payment ledger action.");
  }

  async people(user: AuthenticatedUser) {
    await this.assert(user, "manageAccess");
    const [people, grants] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          fullName: true,
          email: true,
          roles: { select: { role: true } },
        },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.resourceAccessGrant.findMany({
        where: { resourceType: LEDGER_RESOURCE, resourceId: LEDGER_MODULE_ID },
      }),
    ]);
    return people.map((person) => ({
      ...person,
      defaultAccess: isAdminOrCeo({ roles: person.roles.map((r) => r.role) }),
      level: grants.some((g) => g.userId === person.id && g.level === "write")
        ? "write"
        : grants.some((g) => g.userId === person.id)
          ? "read"
          : null,
    }));
  }

  async set(userId: string, level: "read" | "write" | "none", actor: AuthenticatedUser) {
    await this.assert(actor, "manageAccess");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const person = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: true },
      });
      if (isAdminOrCeo({ roles: person.roles.map((r) => r.role) }))
        throw new BadRequestException("The CEO and system administrator retain default access.");
      await tx.resourceAccessGrant.deleteMany({
        where: {
          resourceType: LEDGER_RESOURCE,
          resourceId: LEDGER_MODULE_ID,
          userId,
        },
      });
      if (level !== "none")
        await tx.resourceAccessGrant.create({
          data: {
            resourceType: LEDGER_RESOURCE,
            resourceId: LEDGER_MODULE_ID,
            userId,
            level,
            createdBy: actor.id,
          },
        });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "payment_ledger_access_changed",
          entityType: LEDGER_RESOURCE,
          entityId: userId,
          newValue: { level },
        },
      });
      return { userId, level };
    });
  }
}
