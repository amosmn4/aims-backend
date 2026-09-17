import { Controller, Get, Query } from "@nestjs/common";
import { AuditLogService, type AuditFilters } from "./audit-log.service";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { parsePaginationQuery } from "../common/pagination";

@Controller("audit-log")
@Roles("system_admin")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("userId") userId?: string,
    @Query("area") area?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
  ) {
    return this.auditLogService.findAll(
      user,
      { userId, area, from, to, q },
      parsePaginationQuery(page, pageSize),
    );
  }

  @Get("filters")
  filters(@CurrentUser() user: AuthenticatedUser) {
    return this.auditLogService.filterOptions(user);
  }

  @Get("export")
  export(
    @CurrentUser() user: AuthenticatedUser,
    @Query("userId") userId?: string,
    @Query("area") area?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
  ) {
    const filters: AuditFilters = { userId, area, from, to, q };
    return this.auditLogService.exportRows(user, filters);
  }
}
