import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { can, type PermissionDepartment } from "./permission-resolution";

/**
 * Project Management is cross-department (every department gets "Edit" on its own
 * projects per the RBAC matrix), so it can't use a single static @Roles(...) gate like
 * Finance/Budgets. Delegates to permission-resolution's `can()` for the actual write check —
 * role default, unless a per-user override says otherwise.
 */
export async function assertDepartmentAccess(
  department: PermissionDepartment,
  user: AuthenticatedUser,
  prisma: PrismaService,
): Promise<void> {
  if (!(await can(user, department, "write", prisma))) {
    throw new ForbiddenException(
      `You do not have write access to the ${department.code} department`,
    );
  }
}
