import { ForbiddenException } from "@nestjs/common";
import type { AppRole } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

/**
 * Project Management is cross-department (every department gets "Edit" on its own
 * projects per the RBAC matrix), so it can't use a single static @Roles(...) gate like
 * Finance/Budgets. Department codes match AppRole names 1:1 (finance/hr/it/marketing_ops/tender),
 * so membership is just a role check against the resource's actual department.
 */
export function assertDepartmentAccess(
  department: { code: string },
  user: AuthenticatedUser,
): void {
  if (user.roles.includes("system_admin") || user.roles.includes("ceo")) return;
  if (!user.roles.includes(department.code as AppRole)) {
    throw new ForbiddenException(`You do not have access to the ${department.code} department`);
  }
}
