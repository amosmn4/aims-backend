import type { AppRole } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { isAdminOrCeo } from "./is-admin-or-ceo";

export type PermissionDepartment = { id: string; code: string };
export type PermissionAction = "read" | "write";

// Single resolution point for assertDepartmentAccess/viewerDepartmentCodes. Order: admin/CEO
// bypass, then a per-user override (always wins), then role defaults — the department-code role
// grants both, department_head/account_manager grant both on their own home department,
// general_staff grants read only on their own home department.
export async function can(
  user: AuthenticatedUser,
  department: PermissionDepartment,
  action: PermissionAction,
  prisma: PrismaService,
): Promise<boolean> {
  if (isAdminOrCeo(user)) return true;

  const override = await prisma.userPermissionOverride.findUnique({
    where: {
      userId_departmentId_action: { userId: user.id, departmentId: department.id, action },
    },
  });
  if (override) return override.effect === "grant";

  return roleGrantsDefault(user, department, action);
}

export type PermissionRoleHolder = { roles: AppRole[]; departmentId: string | null };

// Exported so callers that only have a bare {roles, departmentId} (e.g. a listed staff row, not
// a full AuthenticatedUser) can reuse the same role-default logic without a DB round-trip.
export function roleGrantsDefault(
  user: PermissionRoleHolder,
  department: PermissionDepartment,
  action: PermissionAction,
): boolean {
  if (user.roles.includes(department.code as AppRole)) return true;
  if (user.departmentId !== department.id) return false;
  if (user.roles.includes("department_head") || user.roles.includes("account_manager")) {
    return true;
  }
  return user.roles.includes("general_staff") && action === "read";
}
