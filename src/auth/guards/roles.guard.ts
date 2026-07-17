import {
  Injectable,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import type { AuthenticatedUser } from "../types/authenticated-user";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) return false;

    // system_admin and ceo bypass department/module-specific role checks, mirroring the
    // previous is_admin_or_ceo() Postgres helper used across all RLS policies.
    if (user.roles.includes("system_admin") || user.roles.includes("ceo")) return true;

    const authorized = requiredRoles.some((role) => user.roles.includes(role));
    if (!authorized) {
      throw new ForbiddenException("You do not have permission to perform this action");
    }
    return true;
  }
}
