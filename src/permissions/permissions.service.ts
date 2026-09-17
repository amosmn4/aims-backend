import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AppRole, PermissionAction } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { roleGrantsDefault } from "../common/permission-resolution";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { SetOverrideDto } from "./dto/set-override.dto";

const ACTIONS: PermissionAction[] = ["read", "write"];

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  // Admin/CEO manage any department; a department_head manages only their own home department.
  private assertCanManage(actor: AuthenticatedUser, departmentId: string): void {
    if (isAdminOrCeo(actor)) return;
    if (actor.roles.includes("department_head") && actor.departmentId === departmentId) return;
    throw new ForbiddenException("You can't manage permissions for this department");
  }

  async listCapabilities(departmentId: string, actor: AuthenticatedUser) {
    this.assertCanManage(actor, departmentId);
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { id: departmentId },
      select: { id: true, code: true, name: true },
    });

    const [staff, overrides] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          roles: { none: { role: "system_admin" } },
          OR: [{ departmentId }, { roles: { some: { role: department.code as AppRole } } }],
        },
        select: { id: true, fullName: true, email: true, departmentId: true, roles: true },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.userPermissionOverride.findMany({ where: { departmentId } }),
    ]);

    const overrideByUserAction = new Map(
      overrides.map((o) => [`${o.userId}:${o.action}`, o.effect]),
    );

    const staffWithCapabilities = staff.map((user) => {
      const roles = user.roles.map((r) => r.role);
      const capabilities = Object.fromEntries(
        ACTIONS.map((action) => {
          const override = overrideByUserAction.get(`${user.id}:${action}`);
          const roleDefault = roleGrantsDefault(
            { roles, departmentId: user.departmentId },
            department,
            action,
          );
          return [
            action,
            {
              effective: override ? override === "grant" : roleDefault,
              source: override ? "override" : "role",
            },
          ];
        }),
      );
      return {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        roles,
        capabilities: capabilities as Record<
          PermissionAction,
          { effective: boolean; source: "override" | "role" }
        >,
      };
    });

    return { department, staff: staffWithCapabilities };
  }

  async setOverride(dto: SetOverrideDto, actor: AuthenticatedUser) {
    this.assertCanManage(actor, dto.departmentId);

    if (dto.effect === "clear") {
      await this.prisma.userPermissionOverride.deleteMany({
        where: { userId: dto.userId, departmentId: dto.departmentId, action: dto.action },
      });
      return { cleared: true };
    }

    return this.prisma.userPermissionOverride.upsert({
      where: {
        userId_departmentId_action: {
          userId: dto.userId,
          departmentId: dto.departmentId,
          action: dto.action,
        },
      },
      create: {
        userId: dto.userId,
        departmentId: dto.departmentId,
        action: dto.action,
        effect: dto.effect,
        createdBy: actor.id,
      },
      update: { effect: dto.effect, createdBy: actor.id },
    });
  }
}
