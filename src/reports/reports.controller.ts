import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ReportsService } from "./reports.service";
import { ReportsAiService } from "./reports-ai.service";
import { ReportsInboxService } from "./reports-inbox.service";
import { ReportContentService } from "./report-content.service";
import { ReportAccessService } from "./report-access.service";
import {
  ReportAssistDto,
  ReportEmailSubscriptionDto,
  ReportMessageDto,
  ReviewReportDto,
  StartReportDto,
  UpdateReportDto,
} from "./dto/report.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller()
@Roles()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly inbox: ReportsInboxService,
    private readonly ai: ReportsAiService,
    private readonly content: ReportContentService,
    private readonly access: ReportAccessService,
  ) {}

  /* ---------------- The CEO's inbox and the email switches ---------------- */

  @Get("reports-inbox")
  getInbox(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.inbox(user);
  }

  @Get("report-email-subscriptions")
  getEmailSubscriptions(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.emailSubscriptions(user);
  }

  @Put("report-email-subscriptions")
  setEmailSubscription(
    @Body() dto: ReportEmailSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbox.setEmailSubscription(user, dto.reportKey, dto.enabled);
  }

  /* ---------------- Reports ---------------- */

  @Get("reports")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("kind") kind?: string,
    @Query("subjectId") subjectId?: string,
    @Query("departmentId") departmentId?: string,
    @Query("status") status?: string,
    @Query("mine") mine?: string,
    @Query("forReview") forReview?: string,
  ) {
    return this.reports.list(user, {
      kind,
      subjectId,
      departmentId,
      status,
      mine: mine === "true",
      forReview: forReview === "true",
    });
  }

  /** What this person owes for the current period, for the home page. */
  @Get("reports/due")
  due(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.due(user);
  }

  /** A briefing across the month's approved reports. */
  @Post("reports/brief")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  brief(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.briefing(user);
  }

  @Get("reports/ai-status")
  aiStatus() {
    return this.ai.status();
  }

  /** What AIMS would put in a report for this subject and period. */
  @Get("reports/preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query("kind") kind: string,
    @Query("subjectId") subjectId: string,
    @Query("periodStart") periodStart: string,
    @Query("periodEnd") periodEnd: string,
    @Query("template") template?: string,
  ) {
    const reportKind = (["department", "project", "individual"] as const).find((k) => k === kind);
    if (!reportKind) return { figures: [], lists: {} };
    const id = reportKind === "individual" ? user.id : subjectId;
    const chosen =
      (
        [
          "department_monthly",
          "project_progress",
          "project_completion",
          "individual_period",
        ] as const
      ).find((t) => t === template) ??
      (reportKind === "department"
        ? "department_monthly"
        : reportKind === "project"
          ? "project_progress"
          : "individual_period");
    const subject = { kind: reportKind, subjectId: id, subjectUserId: null };
    if (!(await this.access.canWrite(subject, user))) return { figures: [], lists: {} };
    return this.content.build(chosen, id, new Date(periodStart), new Date(periodEnd));
  }

  @Get("reports/:id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.findOne(id, user);
  }

  @Post("reports")
  start(@Body() dto: StartReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.start(dto, user);
  }

  @Patch("reports/:id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.update(id, dto, user);
  }

  @Post("reports/:id/refresh-figures")
  refresh(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.refreshFigures(id, user);
  }

  @Delete("reports/:id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.remove(id, user);
  }

  @Post("reports/:id/review")
  review(
    @Param("id") id: string,
    @Body() dto: ReviewReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.review(id, dto, user);
  }

  @Post("reports/:id/messages")
  addMessage(
    @Param("id") id: string,
    @Body() dto: ReportMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.addMessage(id, dto, user);
  }

  /** AI help. Rate limited because every call costs money. */
  @Post("reports/:id/assist")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  assist(
    @Param("id") id: string,
    @Body() dto: ReportAssistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ai.assist(id, dto, user);
  }

  /* ---------------- The old paths, kept so nothing breaks ---------------- */

  @Get("department-reports")
  listDepartment(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("status") status?: string,
  ) {
    return this.reports.list(user, { kind: "department", departmentId, status });
  }

  @Get("department-reports/:id")
  findOneDepartment(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.findOne(id, user);
  }
}
