import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { DepartmentReportStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import { can, canWithCapability } from "../common/permission-resolution";
import { viewerDepartmentCodes } from "../common/department-scope";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { maskUserRef } from "../common/mask-user-ref";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { ReportNotifierService } from "./report-notifier.service";
import type {
  CreateDepartmentReportDto,
  ReportMessageDto,
  ReviewReportDto,
  UpdateDepartmentReportDto,
} from "./dto/department-report.dto";

const USER_REF = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;
const EDITABLE: DepartmentReportStatus[] = ["draft", "changes_requested"];
const STATUSES: DepartmentReportStatus[] = ["draft", "submitted", "changes_requested", "approved"];

@Injectable()
export class DepartmentReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly notifier: ReportNotifierService,
  ) {}

  async list(user: AuthenticatedUser, filters: { departmentId?: string; status?: string }) {
    const codes = await viewerDepartmentCodes(user, this.prisma);
    const status = STATUSES.find((s) => s === filters.status);
    const rows = await this.prisma.departmentReport.findMany({
      where: {
        ...(filters.departmentId && { departmentId: filters.departmentId }),
        ...(status && { status }),
        ...(codes && { department: { code: { in: codes } } }),
        // The CEO never sees another department's unsent drafts.
        ...(isAdminOrCeo(user) && { NOT: { status: "draft" } }),
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        creator: { select: USER_REF },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { author: { select: USER_REF } },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(({ messages, ...r }) => ({
      ...r,
      creator: maskUserRef(r.creator, user),
      lastMessage: messages[0]
        ? { ...messages[0], author: maskUserRef(messages[0].author, user) }
        : null,
    }));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const report = await this.prisma.departmentReport.findUnique({
      where: { id },
      include: {
        department: true,
        creator: { select: USER_REF },
        reviewer: { select: USER_REF },
        messages: { orderBy: { createdAt: "asc" }, include: { author: { select: USER_REF } } },
      },
    });
    if (!report) throw new NotFoundException("Report not found");
    const canWrite = await can(user, report.department, "write", this.prisma);
    const reviewer = isAdminOrCeo(user);
    if (report.status === "draft" && (!canWrite || (reviewer && report.createdBy !== user.id))) {
      throw new NotFoundException("Report not found");
    }
    if (!reviewer && !(await can(user, report.department, "read", this.prisma))) {
      throw new NotFoundException("Report not found");
    }
    return {
      ...report,
      creator: maskUserRef(report.creator, user),
      reviewer: report.reviewer ? maskUserRef(report.reviewer, user) : null,
      messages: report.messages.map((m) => ({ ...m, author: maskUserRef(m.author, user) })),
      canEdit: EDITABLE.includes(report.status) && canWrite,
      canReview: reviewer && report.status === "submitted",
    };
  }

  async create(dto: CreateDepartmentReportDto, user: AuthenticatedUser) {
    const department = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!department) throw new BadRequestException("Choose a department");
    await this.assertWrite(department, user);
    this.assertPeriod(dto.periodStart, dto.periodEnd);
    const now = new Date();
    const report = await this.prisma.departmentReport.create({
      data: {
        departmentId: department.id,
        title: dto.title.trim(),
        periodType: dto.periodType,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        summary: dto.summary?.trim() || null,
        figures: dto.figures as unknown as Prisma.InputJsonValue,
        status: dto.submit ? "submitted" : "draft",
        submittedBy: dto.submit ? user.id : null,
        submittedAt: dto.submit ? now : null,
        createdBy: user.id,
      },
    });
    if (dto.submit) await this.recordSubmission(report, department.name, user, false, dto.note);
    return report;
  }

  async update(id: string, dto: UpdateDepartmentReportDto, user: AuthenticatedUser) {
    const report = await this.prisma.departmentReport.findUnique({
      where: { id },
      include: { department: true },
    });
    if (!report) throw new NotFoundException("Report not found");
    await this.assertWrite(report.department, user);
    if (!EDITABLE.includes(report.status)) {
      throw new BadRequestException(
        "This report is with the CEO. You can edit it again if changes are requested.",
      );
    }
    this.assertPeriod(
      dto.periodStart ?? report.periodStart.toISOString(),
      dto.periodEnd ?? report.periodEnd.toISOString(),
    );
    const wasSentBack = report.status === "changes_requested";
    const updated = await this.prisma.departmentReport.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        periodType: dto.periodType,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        summary: dto.summary === undefined ? undefined : dto.summary.trim() || null,
        figures: dto.figures ? (dto.figures as unknown as Prisma.InputJsonValue) : undefined,
        ...(dto.submit && { status: "submitted", submittedBy: user.id, submittedAt: new Date() }),
      },
    });
    if (dto.submit)
      await this.recordSubmission(updated, report.department.name, user, wasSentBack, dto.note);
    return updated;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const report = await this.prisma.departmentReport.findUnique({
      where: { id },
      include: { department: true },
    });
    if (!report) throw new NotFoundException("Report not found");
    await this.assertWrite(report.department, user);
    if (report.status !== "draft")
      throw new BadRequestException("Only a draft report can be deleted");
    await this.documents.deleteAllForResource("department_report", id);
    await this.prisma.departmentReport.delete({ where: { id } });
    return { id };
  }

  async review(id: string, dto: ReviewReportDto, user: AuthenticatedUser) {
    if (!isAdminOrCeo(user)) throw new ForbiddenException("Only the CEO can review reports");
    const report = await this.prisma.departmentReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException("Report not found");
    if (report.status !== "submitted")
      throw new BadRequestException("Only a submitted report can be reviewed");
    const approve = dto.decision === "approve";
    const note = dto.note?.trim();
    if (!approve && !note)
      throw new BadRequestException("Say what needs to change before sending the report back");
    const updated = await this.prisma.departmentReport.update({
      where: { id },
      data: {
        status: approve ? "approved" : "changes_requested",
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
    });
    await this.prisma.departmentReportMessage.create({
      data: {
        reportId: id,
        authorId: user.id,
        kind: approve ? "approved" : "changes_requested",
        body: note || "Approved.",
      },
    });
    await this.notifier.notify([report.createdBy, report.submittedBy], {
      type: "report_reviewed",
      title: approve ? `Approved: ${report.title}` : `Changes requested: ${report.title}`,
      body: note,
      resourceType: "department_report",
      resourceId: id,
      actorId: user.id,
    });
    return updated;
  }

  async addMessage(id: string, dto: ReportMessageDto, user: AuthenticatedUser) {
    const report = await this.prisma.departmentReport.findUnique({
      where: { id },
      include: { department: true },
    });
    if (!report) throw new NotFoundException("Report not found");
    const reviewer = isAdminOrCeo(user);
    if (!reviewer && !(await can(user, report.department, "read", this.prisma))) {
      throw new NotFoundException("Report not found");
    }
    if (report.status === "draft")
      throw new BadRequestException("Submit the report before starting a conversation");
    if (dto.parentId) {
      const parent = await this.prisma.departmentReportMessage.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent || parent.reportId !== id)
        throw new BadRequestException("You can only reply to a message on this report");
    }
    const body = dto.body.trim();
    const message = await this.prisma.departmentReportMessage.create({
      data: { reportId: id, authorId: user.id, body, parentId: dto.parentId ?? null },
      include: { author: { select: USER_REF } },
    });
    const event = {
      type: "report_comment" as const,
      title: `New message on ${report.title}`,
      body: body.slice(0, 200),
      resourceType: "department_report" as const,
      resourceId: id,
      actorId: user.id,
    };
    if (reviewer) await this.notifier.notify([report.createdBy, report.submittedBy], event);
    else await this.notifier.toCeo(event);
    return { ...message, author: maskUserRef(message.author, user) };
  }

  private async recordSubmission(
    report: { id: string; title: string },
    departmentName: string,
    user: AuthenticatedUser,
    resubmitted: boolean,
    note?: string,
  ) {
    await this.prisma.departmentReportMessage.create({
      data: {
        reportId: report.id,
        authorId: user.id,
        kind: resubmitted ? "resubmitted" : "submitted",
        body:
          note?.trim() || (resubmitted ? "Updated and resubmitted." : "Submitted for your review."),
      },
    });
    const verb = resubmitted ? "resubmitted" : "submitted";
    await this.notifier.toCeo(
      {
        type: "report_submitted",
        title: `${departmentName} ${verb}: ${report.title}`,
        body: note?.trim(),
        resourceType: "department_report",
        resourceId: report.id,
        actorId: user.id,
      },
      `${departmentName} ${verb} a report: ${report.title}`,
    );
  }

  private async assertWrite(department: { id: string; code: string }, user: AuthenticatedUser) {
    if (!(await canWithCapability(user, department, "submit_reports", this.prisma))) {
      throw new ForbiddenException("Only people in this department can prepare its reports");
    }
  }

  private assertPeriod(start: string, end: string) {
    if (new Date(start) > new Date(end))
      throw new BadRequestException("The period must end after it starts");
  }
}
