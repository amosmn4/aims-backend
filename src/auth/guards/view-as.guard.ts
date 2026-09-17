import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../types/authenticated-user";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_PATHS = new Set(["/api/v1/auth/view-as/exit", "/api/v1/auth/logout"]);

@Injectable()
export class ViewAsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user?.actorId || READ_METHODS.has(request.method)) return true;
    const path = String(request.originalUrl ?? request.url ?? "").split("?")[0];
    if (ALLOWED_PATHS.has(path)) return true;
    throw new ForbiddenException("Changes are turned off in this view.");
  }
}
