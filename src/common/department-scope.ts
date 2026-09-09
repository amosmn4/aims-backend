import type { AppRole } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { isAdminOrCeo } from "./is-admin-or-ceo";

const DEPARTMENT_ROLES: AppRole[] = ["finance", "hr", "it", "marketing", "tender", "operations"];

/**
 * The read-side counterpart to assertDepartmentAccess (which only ever gated writes) — every
 * list/detail endpoint that carries a department needs this too, or "only mutations are
 * department-gated" quietly means any authenticated user can read every other department's data
 * by simply not passing a departmentId filter. Batches the department list + this viewer's
 * overrides into two queries rather than resolving each department one at a time.
 *
 * Returns `null` for system_admin/CEO — the "no restriction, see everything" case, same convention
 * as assertDepartmentAccess's own early-return. A viewer holding zero department access gets `[]`
 * (sees nothing department-scoped) rather than falling through to "everything" — least privilege
 * by default, not fail-open.
 */
export async function viewerDepartmentCodes(
  viewer: AuthenticatedUser,
  prisma: PrismaService,
): Promise<string[] | null> {
  if (isAdminOrCeo(viewer)) return null;

  const [departments, overrides] = await Promise.all([
    prisma.department.findMany({
      where: { code: { in: DEPARTMENT_ROLES } },
      select: { id: true, code: true },
    }),
    prisma.userPermissionOverride.findMany({
      where: { userId: viewer.id, action: "read" },
      select: { departmentId: true, effect: true },
    }),
  ]);
  const overrideByDept = new Map(overrides.map((o) => [o.departmentId, o.effect]));

  return departments
    .filter((dept) => {
      const override = overrideByDept.get(dept.id);
      if (override) return override === "grant";
      if (viewer.roles.includes(dept.code as AppRole)) return true;
      if (viewer.departmentId !== dept.id) return false;
      if (viewer.roles.includes("department_head") || viewer.roles.includes("account_manager")) {
        return true;
      }
      return viewer.roles.includes("general_staff");
    })
    .map((dept) => dept.code);
}
