import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { DepartmentReportsService } from "./department-reports.service";
import { SuggestedFiguresService } from "./suggested-figures.service";
import { ReportsInboxService } from "./reports-inbox.service";
import {
  CreateDepartmentReportDto,
  ReportEmailSubscriptionDto,
  ReportMessageDto,
  ReviewReportDto,
  UpdateDepartmentReportDto,
} from "./dto/department-report.dto";

@Controller()
@Roles()
export class DepartmentReportsController {
  constructor(
    private readonly reports: DepartmentReportsService,
    private readonly figures: SuggestedFiguresService,
    private readonly inbox: ReportsInboxService,
  ) {}

  @Get("reports-inbox")
  getInbox(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.inbox(user);
  }

  @Get("report-email-subscriptions")
  getSubscriptions(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.emailSubscriptions(user);
  }

  @Put("report-email-subscriptions")
  setSubscription(@Body() dto: ReportEmailSubscriptionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inbox.setEmailSubscription(user, dto.reportKey, dto.enabled);
  }

  @Get("department-reports")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("status") status?: string,
  ) {
    return this.reports.list(user, { departmentId, status });
  }

  @Get("department-reports/suggested-figures")
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId: string,
    @Query("periodStart") periodStart: string,
    @Query("periodEnd") periodEnd: string,
  ) {
    return this.figures.suggest(departmentId, periodStart, periodEnd, user);
  }

  @Get("department-reports/:id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.findOne(id, user);
  }

  @Post("department-reports")
  create(@Body() dto: CreateDepartmentReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.create(dto, user);
  }

  @Patch("department-reports/:id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateDepartmentReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.update(id, dto, user);
  }

  @Delete("department-reports/:id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.remove(id, user);
  }

  @Post("department-reports/:id/review")
  review(
    @Param("id") id: string,
    @Body() dto: ReviewReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.review(id, dto, user);
  }

  @Post("department-reports/:id/messages")
  addMessage(
    @Param("id") id: string,
    @Body() dto: ReportMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.addMessage(id, dto, user);
  }
}
