import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { PaymentLedgerAccessService } from "../../payment-ledger/payment-ledger-access.service";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class OpsLedgerAccessService extends PaymentLedgerAccessService {
  constructor(private readonly opsDb: PrismaService) {
    super(opsDb);
  }

  override async access(user: AuthenticatedUser) {
    const staff = await this.opsDb.opsStaff.findUnique({
      where: { userId: user.id },
      include: {
        user: { select: { isActive: true } },
        moduleGrants: { where: { module: "ledger" } },
      },
    });
    if (!staff?.active || !staff.user?.isActive || staff.role === "system_admin" || user.actorId)
      return { read: false, write: false, manageAccess: false };
    const level = staff.moduleGrants[0]?.access;
    return {
      read: level === "view" || level === "manage",
      write: level === "manage",
      manageAccess: staff.role === "ceo",
    };
  }

  override async people(): Promise<never> {
    throw new ForbiddenException("Manage Ledger permissions through Ops Admin.");
  }
  override async set(): Promise<never> {
    throw new ForbiddenException("Manage Ledger permissions through Ops Admin.");
  }
}
