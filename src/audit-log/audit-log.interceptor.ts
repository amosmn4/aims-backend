import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { Prisma } from "@prisma/client";
import { AuditLogService } from "./audit-log.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
// Auth endpoints carry credentials/tokens in their bodies and aren't a business entity
// mutation — excluded so a login attempt never ends up copied into audit_log.new_value.
const SKIP_PREFIXES = ["/api/v1/auth"];
const MAX_VALUE_LENGTH = 4000;

/**
 * Automatically records every mutating request (POST/PATCH/PUT/DELETE) made by an
 * authenticated user, so new modules get audit coverage for free instead of relying on each
 * service remembering to call AuditLogService.create() itself — the previous state, where
 * nothing anywhere called it, is exactly the gap this closes.
 *
 * Deliberately scoped: this captures *what* happened (action, entity, resulting value) and
 * *who* did it, not a full before/after diff — computing a true "oldValue" generically would
 * need a pre-fetch keyed off a dynamic entity type, which is more machinery than the
 * recommendation called for.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLog: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method: string = request.method;
    const path: string = request.originalUrl ?? request.url ?? "";

    if (!MUTATING_METHODS.has(method) || SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next.handle();
    }

    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return next.handle();

    const routePattern: string = request.route?.path ?? path;
    const entityType = this.deriveEntityType(context.getClass().name);
    const paramId: string | undefined =
      request.params?.id ?? request.params?.activityId ?? request.params?.itemId ?? request.params?.bondId;

    return next.handle().pipe(
      tap((responseBody) => {
        const entityId =
          paramId ??
          (responseBody && typeof responseBody === "object"
            ? (responseBody as { id?: string }).id
            : undefined) ??
          null;

        this.auditLog
          .create({
            userId: user.id,
            action: `${method} ${routePattern}`,
            entityType,
            entityId,
            newValue: this.safeValue(responseBody),
            metadata: { path },
          })
          .catch(() => {
            // Audit logging must never break the request it's observing.
          });
      }),
    );
  }

  private deriveEntityType(controllerName: string): string {
    return controllerName
      .replace(/Controller$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
  }

  private safeValue(value: unknown): Prisma.InputJsonValue | undefined {
    if (value == null || typeof value !== "object") return undefined;
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_VALUE_LENGTH) {
        return { truncated: true, preview: json.slice(0, MAX_VALUE_LENGTH) };
      }
      return JSON.parse(json) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
}
