import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { maskUserRef } from "../common/mask-user-ref";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

export interface AuditLogEntry {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  // The audit log is readable by CEO as well as system_admin (see the controller), so any
  // entry left by a system admin must have its identity masked from a CEO viewer — otherwise
  // this becomes the one screen in the app where admin invisibility quietly breaks.
  //
  // On top of that: the very first system_admin account ever created (the bootstrap "super
  // admin" from prisma/seed.ts) is treated as senior to every admin created after it — its own
  // entries are dropped from the log entirely for anyone except itself, not just masked. Any
  // later system_admin (or a CEO who's also been granted system_admin) can audit each other, but
  // not the original root account.
  async findAll(viewer: AuthenticatedUser) {
    const superAdmin = await this.prisma.user.findFirst({
      where: { roles: { some: { role: "system_admin" } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const viewerIsSuperAdmin = !!superAdmin && superAdmin.id === viewer.id;

    const rows = await this.prisma.auditLog.findMany({
      where: superAdmin && !viewerIsSuperAdmin ? { userId: { not: superAdmin.id } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: {
          select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
        },
      },
    });
    return rows.map((row) => ({
      ...row,
      user: row.user ? maskUserRef(row.user, viewer) : null,
    }));
  }

  create(entry: AuditLogEntry) {
    return this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? undefined,
        oldValue: entry.oldValue ?? undefined,
        newValue: entry.newValue ?? undefined,
        metadata: entry.metadata ?? undefined,
      },
    });
  }
}
