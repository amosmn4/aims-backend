import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { Viewer } from "./ops.schemas";

export const OpsFeature = (module: "water" | "blog" | "ledger") =>
  SetMetadata("opsFeature", module);
export const OpsFeatureRead = () => SetMetadata("opsFeatureRead", true);

@Injectable()
export class OpsModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const viewer = request.opsViewer as Viewer;
    const module = this.reflector.getAllAndOverride<"water" | "blog" | "ledger">("opsFeature", [
      context.getHandler(),
      context.getClass(),
    ]);
    const read =
      ["GET", "HEAD"].includes(request.method) ||
      this.reflector.get<boolean>("opsFeatureRead", context.getHandler());
    const access = viewer?.role === "system_admin" ? undefined : viewer?.modules?.[module];
    if (!viewer?.userId || !module || !access || (!read && access !== "manage"))
      throw new ForbiddenException("You do not have the required module access.");
    context.switchToHttp().getResponse().setHeader("Cache-Control", "private, no-store");
    request.user = {
      id: viewer.userId,
      email: viewer.email,
      roles: module === "water" ? ["water"] : module === "blog" ? ["marketing"] : [],
      departmentId: null,
    } satisfies AuthenticatedUser;
    return true;
  }
}
