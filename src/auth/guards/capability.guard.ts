import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CAPABILITY_KEY, DEPARTMENT_VIEWERS_KEY } from "../decorators/require-capability.decorator";
import { userCan, type Capability } from "../../common/capabilities";
import { viewerDepartmentCodes } from "../../common/department-scope";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../types/authenticated-user";

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const capability = this.reflector.getAllAndOverride<Capability | undefined>(
      CAPABILITY_KEY,
      targets,
    );
    if (!capability) return true;
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) return false;
    if (userCan(user, capability)) return true;
    const viewersOf = this.reflector.get<string | undefined>(
      DEPARTMENT_VIEWERS_KEY,
      context.getHandler(),
    );
    if (viewersOf) {
      const codes = await viewerDepartmentCodes(user, this.prisma);
      if (codes === null || codes.includes(viewersOf)) return true;
    }
    throw new ForbiddenException("Your role doesn't allow this. Ask the CEO if you need it.");
  }
}
