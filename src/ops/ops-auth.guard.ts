import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { OpsAuthService } from "./ops-auth.service";
import type { Viewer } from "./ops.schemas";

@Injectable()
export class OpsAuthGuard implements CanActivate {
  constructor(private readonly auth: OpsAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer "))
      throw new UnauthorizedException("Please sign in.");
    request.opsViewer = await this.auth.authenticate(header.slice(7));
    context.switchToHttp().getResponse().setHeader("Cache-Control", "private, no-store");
    return true;
  }
}

export const OpsViewer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Viewer =>
    context.switchToHttp().getRequest().opsViewer,
);
