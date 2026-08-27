import { Controller, Get, Query } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { parsePaginationQuery } from "../common/pagination";

@Controller("audit-log")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  // Bare @Roles("system_admin") is enough: the RolesGuard's ceo/system_admin bypass means
  // CEO can also read this, matching "Audit Log" being an Admin-only module elsewhere.
  @Get()
  @Roles("system_admin")
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.auditLogService.findAll(user, parsePaginationQuery(page, pageSize));
  }
}
