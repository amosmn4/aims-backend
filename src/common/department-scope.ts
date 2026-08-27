import type { AppRole } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const DEPARTMENT_ROLES: AppRole[] = ["finance", "hr", "it", "marketing", "tender", "operations"];

/**
 * The read-side counterpart to assertDepartmentAccess (which only ever gated writes) — every
 * list/detail endpoint that carries a department needs this too, or "only mutations are
 * department-gated" quietly means any authenticated user can read every other department's data
 * by simply not passing a departmentId filter. Mirrors the frontend's departmentScopeFor: exactly
 * the department-code role(s) a user holds, from `roles`, not the separate `user.departmentId`
 * "home department" column (roles are the actual authorization signal used everywhere else).
 *
 * Returns `null` for system_admin/CEO — the "no restriction, see everything" case, same convention
 * as assertDepartmentAccess's own early-return. A viewer holding zero department-code roles gets
 * `[]` (sees nothing department-scoped) rather than falling through to "everything" — least
 * privilege by default, not fail-open.
 */
export function viewerDepartmentCodes(viewer: AuthenticatedUser): string[] | null {
  if (viewer.roles.includes("system_admin") || viewer.roles.includes("ceo")) return null;
  return DEPARTMENT_ROLES.filter((r) => viewer.roles.includes(r));
}
