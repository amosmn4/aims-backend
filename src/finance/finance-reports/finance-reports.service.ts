import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DocumentsService } from "../../documents/documents.service";
import type { CreateFinanceReportDto } from "./dto/create-finance-report.dto";
import type { UpdateReportStatusDto } from "./dto/update-report-status.dto";
import type { UpdateFinanceReportDto } from "./dto/update-finance-report.dto";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { ReportNotifierService } from "../../reports/report-notifier.service";
import { maskUserRef } from "../../common/mask-user-ref";

const USER_REF = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;

@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly notifier: ReportNotifierService,
  ) {}

  findAll() {
    return this.prisma.financeReport.findMany({ orderBy: { createdAt: "desc" } });
  }

  findOne(id: string) {
    return this.prisma.financeReport.findUniqueOrThrow({ where: { id } });
  }

  async create(dto: CreateFinanceReportDto, userId: string) {
    const now = new Date();
    const report = await this.prisma.financeReport.create({
      data: {
        reportType: dto.reportType,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        title: dto.title,
        narrative: dto.narrative,
        snapshot: dto.snapshot as Prisma.InputJsonValue,
        status: dto.submit ? "submitted" : "draft",
        submittedBy: dto.submit ? userId : undefined,
        submittedAt: dto.submit ? now : undefined,
        createdBy: userId,
      },
    });
    if (dto.submit) await this.recordSubmission(report, userId, false);
    return report;
  }

  private async recordSubmission(
    report: { id: string; title: string },
    userId: string,
    resubmitted: boolean,
  ) {
    await this.prisma.financeReportComment.create({
      data: {
        reportId: report.id,
        authorId: userId,
        kind: resubmitted ? "resubmitted" : "submitted",
        body: resubmitted ? "Updated and resubmitted." : "Submitted for your review.",
      },
    });
    const verb = resubmitted ? "resubmitted" : "submitted";
    await this.notifier.toCeo(
      {
        type: "report_submitted",
        title: `Finance ${verb}: ${report.title}`,
        resourceType: "finance_report",
        resourceId: report.id,
        actorId: userId,
      },
      `Finance ${verb} a report: ${report.title}`,
    );
  }

  // The author (or an admin) may edit a report until it's submitted, and again after changes are requested.
  private assertEditable(
    report: { status: string; createdBy: string },
    user: AuthenticatedUser,
    action: string,
  ) {
    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if (report.createdBy !== user.id && !isAdminOrCeo) {
      throw new ForbiddenException(`Only the report's author can ${action} it`);
    }
    if (report.status !== "draft" && report.status !== "changes_requested") {
      throw new BadRequestException(
        `A report that is ${report.status.replace("_", " ")} can't be ${action}ed`,
      );
    }
  }

  async update(id: string, dto: UpdateFinanceReportDto, user: AuthenticatedUser) {
    const report = await this.prisma.financeReport.findUniqueOrThrow({ where: { id } });
    this.assertEditable(report, user, "edit");
    const now = new Date();
    const updated = await this.prisma.financeReport.update({
      where: { id },
      data: {
        title: dto.title,
        narrative: dto.narrative,
        ...(dto.snapshot && { snapshot: dto.snapshot as Prisma.InputJsonValue }),
        ...(dto.submit && { status: "submitted", submittedBy: user.id, submittedAt: now }),
      },
    });
    if (dto.submit)
      await this.recordSubmission(updated, user.id, report.status === "changes_requested");
    return updated;
  }

  async updateStatus(id: string, dto: UpdateReportStatusDto, user: AuthenticatedUser) {
    // Separation of duties: authors submit; only the CEO reviews.
    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if ((dto.status === "approved" || dto.status === "changes_requested") && !isAdminOrCeo) {
      throw new ForbiddenException("Only the CEO can review reports");
    }
    const report = await this.prisma.financeReport.findUniqueOrThrow({ where: { id } });
    if (dto.status === "submitted") this.assertEditable(report, user, "submit");
    if (dto.status === "draft") {
      throw new BadRequestException("A report can't be moved back to draft");
    }

    const now = new Date();
    const data: Prisma.FinanceReportUncheckedUpdateInput = { status: dto.status };
    if (dto.status === "submitted") {
      data.submittedBy = user.id;
      data.submittedAt = now;
    }
    const review = dto.status === "approved" || dto.status === "changes_requested";
    if (review) {
      if (report.status !== "submitted")
        throw new BadRequestException("Only a submitted report can be reviewed");
      if (dto.status === "changes_requested" && !dto.reviewNote?.trim()) {
        throw new BadRequestException("Say what needs to change before sending the report back");
      }
      data.reviewedBy = user.id;
      data.reviewedAt = now;
      data.reviewNote = dto.reviewNote;
    }
    const updated = await this.prisma.financeReport.update({ where: { id }, data });
    if (dto.status === "submitted")
      await this.recordSubmission(updated, user.id, report.status === "changes_requested");
    if (review) {
      const approved = dto.status === "approved";
      await this.prisma.financeReportComment.create({
        data: {
          reportId: id,
          authorId: user.id,
          kind: approved ? "approved" : "changes_requested",
          body: dto.reviewNote?.trim() || "Approved.",
        },
      });
      await this.notifier.notify([report.createdBy, report.submittedBy], {
        type: "report_reviewed",
        title: approved ? `Approved: ${report.title}` : `Changes requested: ${report.title}`,
        body: dto.reviewNote?.trim(),
        resourceType: "finance_report",
        resourceId: id,
        actorId: user.id,
      });
    }
    return updated;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const report = await this.prisma.financeReport.findUniqueOrThrow({ where: { id } });
    this.assertEditable(report, user, "delete");
    await this.documentsService.deleteAllForResource("finance_report", id);
    return this.prisma.financeReport.delete({ where: { id } });
  }

  async findComments(reportId: string, viewer: AuthenticatedUser) {
    const rows = await this.prisma.financeReportComment.findMany({
      where: { reportId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: USER_REF } },
    });
    return rows.map((c) => ({ ...c, author: maskUserRef(c.author, viewer) }));
  }

  async addComment(reportId: string, body: string, user: AuthenticatedUser, parentId?: string) {
    const report = await this.prisma.financeReport.findUniqueOrThrow({ where: { id: reportId } });
    if (parentId) {
      const parent = await this.prisma.financeReportComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.reportId !== reportId) {
        throw new BadRequestException("You can only reply to a message on this report");
      }
    }
    const comment = await this.prisma.financeReportComment.create({
      data: { reportId, authorId: user.id, body: body.trim(), parentId: parentId ?? null },
      include: { author: { select: USER_REF } },
    });
    const event = {
      type: "report_comment" as const,
      title: `New message on ${report.title}`,
      body: body.trim().slice(0, 200),
      resourceType: "finance_report" as const,
      resourceId: reportId,
      actorId: user.id,
    };
    const reviewer = user.roles.includes("ceo") || user.roles.includes("system_admin");
    if (reviewer) await this.notifier.notify([report.createdBy, report.submittedBy], event);
    else await this.notifier.toCeo(event);
    return { ...comment, author: maskUserRef(comment.author, user) };
  }
}
