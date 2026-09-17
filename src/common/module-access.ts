import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { canWithCapability } from "./permission-resolution";
import { isAdminOrCeo } from "./is-admin-or-ceo";

/** True when the user can manage a department's module: its role, its head, or a write override. */
export async function canWriteModule(
  code: string,
  user: AuthenticatedUser,
  prisma: PrismaService,
): Promise<boolean> {
  if (isAdminOrCeo(user)) return true;
  const department = await prisma.department.findUnique({ where: { code } });
  if (!department) return false;
  const capability =
    code === "tender"
      ? "manage_tenders"
      : code === "operations"
        ? "log_client_requests"
        : "edit_department";
  return canWithCapability(user, department, capability, prisma);
}

export async function assertModuleWrite(
  code: string,
  user: AuthenticatedUser,
  prisma: PrismaService,
  message: string,
): Promise<void> {
  if (!(await canWriteModule(code, user, prisma))) throw new ForbiddenException(message);
}
