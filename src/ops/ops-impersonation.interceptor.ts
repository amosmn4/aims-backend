import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { mergeMap } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { auditActor } from "./ops-session";
import type { Viewer } from "./ops.schemas";

@Injectable()
export class OpsImpersonationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OpsImpersonationInterceptor.name);
  constructor(private readonly db: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const viewer = req.opsViewer as Viewer | undefined;
    if (!viewer?.impersonation || ["GET", "HEAD", "OPTIONS"].includes(req.method))
      return next.handle();
    return next.handle().pipe(
      mergeMap(async (value) => {
        const actor = auditActor(viewer);
        try {
          await this.db.auditLog.create({
            data: {
              ...actor,
              action: "ops.impersonation.action",
              entityType: "ops_staff",
              entityId: viewer.id,
              metadata: {
                ...actor.metadata,
                method: req.method,
                path: req.originalUrl.split("?")[0],
              },
            },
          });
        } catch (error) {
          this.logger.error(
            "Could not record the impersonated request",
            error instanceof Error ? error.stack : undefined,
          );
        }
        return value;
      }),
    );
  }
}
