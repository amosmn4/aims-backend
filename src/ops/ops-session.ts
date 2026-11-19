import { UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Viewer } from "./ops.schemas";

export async function loadOpsSession(
  db: Pick<Prisma.TransactionClient, "opsSession">,
  sessionId: string,
  staffId?: string,
  version?: number,
) {
  const profile = {
    moduleGrants: true,
    user: { select: { email: true, isActive: true } },
  } as const;
  const session = await db.opsSession.findUnique({
    where: { id: sessionId },
    include: { staff: { include: profile }, impersonatedStaff: { include: profile } },
  });
  const now = new Date();
  if (
    !session ||
    session.expiresAt <= now ||
    session.idleExpiresAt <= now ||
    (staffId !== undefined && session.staffId !== staffId) ||
    (version !== undefined && session.impersonationVersion !== version) ||
    !session.staff.active ||
    !session.staff.user?.isActive
  )
    throw new UnauthorizedException("Your session has expired. Please sign in again.");
  const staff = session.impersonatedStaff ?? session.staff;
  if (
    session.impersonatedStaffId &&
    (session.staff.role !== "system_admin" ||
      !session.impersonatedStaff ||
      staff.role !== "ceo" ||
      !staff.active ||
      !staff.user?.isActive)
  )
    throw new UnauthorizedException("CEO impersonation is no longer available.");
  const viewer: Viewer = {
    id: staff.id,
    userId: staff.userId,
    name: staff.name,
    title: staff.title,
    dept: staff.dept,
    role: staff.role,
    active: staff.active,
    email: staff.user!.email,
    sessionId: session.id,
    sessionVersion: session.impersonationVersion,
    modules: Object.fromEntries(staff.moduleGrants.map((grant) => [grant.module, grant.access])),
    ...(session.impersonatedStaffId
      ? {
          impersonation: {
            staffId: session.staff.id,
            userId: session.staff.userId!,
            name: session.staff.name,
            email: session.staff.user!.email,
          },
        }
      : {}),
  };
  return { session, viewer };
}

export function auditActor(viewer: Viewer) {
  return {
    userId: viewer.impersonation?.userId ?? viewer.userId,
    ...(viewer.impersonation
      ? {
          metadata: {
            impersonatorStaffId: viewer.impersonation.staffId,
            impersonatorUserId: viewer.impersonation.userId,
            actingStaffId: viewer.id,
            actingUserId: viewer.userId,
            sessionId: viewer.sessionId,
          },
        }
      : {}),
  };
}
