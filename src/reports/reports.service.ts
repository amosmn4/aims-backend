import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, ReportKind, ReportStatus, ReportTemplate } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import { viewerDepartmentCodes } from "../common/department-scope";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { maskUserRef } from "../common/mask-user-ref";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { ReportNotifierService } from "./report-notifier.service";
import { ReportAccessService } from "./report-access.service";
import { ReportContentService } from "./report-content.service";
import { mergeFigures, readFigures, withPrevious, type ReportFigure } from "./report-figures";
import {
  missingSections,
  readSections,
  templateSections,
  TEMPLATES,
  type ReportSection,
} from "./report-sections";
import type {
  ReportMessageDto,
  ReviewReportDto,
  StartReportDto,
  UpdateReportDto,
} from "./dto/report.dto";

const USER_REF = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;

const EDITABLE: ReportStatus[] = ["draft", "changes_requested"];
const STATUSES: ReportStatus[] = ["draft", "submitted", "changes_requested", "approved"];

const TEMPLATE_FOR: Record<ReportKind, ReportTemplate> = {
  department: "department_monthly",
  project: "project_progress",
  individual: "individual_period",
};

/** Last calendar month, which is what a monthly report almost always covers. */
function lastMonth(today = new Date()) {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  return { start, end };
}

const monthName = (d: Date) =>
  d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly notifier: ReportNotifierService,
    private readonly access: ReportAccessService,
    private readonly content: ReportContentService,
  ) {}

  /* ---------------- Reading ---------------- */

  async list(
    user: AuthenticatedUser,
    filters: {
      kind?: string;
      subjectId?: string;
      departmentId?: string;
      status?: string;
      mine?: boolean;
      forReview?: boolean;
    },
  ) {
    const codes = await viewerDepartmentCodes(user, this.prisma);
    const status = STATUSES.find((s) => s === filters.status);
    const kind = (["department", "project", "individual"] as const).find((k) => k === filters.kind);

    const where: Prisma.ReportWhereInput = {
      ...(kind && { kind }),
      ...(filters.subjectId && { subjectId: filters.subjectId }),
      ...(filters.departmentId && { departmentId: filters.departmentId }),
      ...(status && { status }),
    };

    if (filters.mine) {
      where.subjectUserId = user.id;
    } else if (filters.forReview) {
      // What is sitting with this person to decide on.
      where.status = status ?? "submitted";
      if (!isAdminOrCeo(user)) {
        where.reviewerKind = "department_head";
        where.departmentId = user.departmentId ?? "none";
      }
    } else {
      // A person's own report is theirs alone; everything else follows department scope.
      const scope: Prisma.ReportWhereInput[] = [
        { kind: { not: "individual" }, ...(codes && { department: { code: { in: codes } } }) },
        { kind: "individual", subjectUserId: user.id },
      ];
      if (user.roles.includes("department_head") && user.departmentId) {
        scope.push({ kind: "individual", departmentId: user.departmentId });
      }
      if (!isAdminOrCeo(user)) where.OR = scope;
      // Nobody sees another person's unsent draft.
      where.NOT = [{ status: "draft", createdBy: { not: user.id } }];
    }

    const rows = await this.prisma.report.findMany({
      where,
      include: {
        department: { select: { id: true, name: true, code: true } },
        subjectUser: { select: USER_REF },
        creator: { select: USER_REF },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { author: { select: USER_REF } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    return rows.map(({ messages, ...r }) => ({
      ...r,
      figures: readFigures(r.figures),
      creator: maskUserRef(r.creator, user),
      subjectUser: r.subjectUser ? maskUserRef(r.subjectUser, user) : null,
      lastMessage: messages[0]
        ? { ...messages[0], author: maskUserRef(messages[0].author, user) }
        : null,
    }));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const base = await this.access.loadReadable(id, user);
    const report = await this.prisma.report.findUniqueOrThrow({
      where: { id },
      include: {
        department: true,
        subjectUser: { select: USER_REF },
        creator: { select: USER_REF },
        reviewer: { select: USER_REF },
        messages: { orderBy: { createdAt: "asc" }, include: { author: { select: USER_REF } } },
      },
    });

    const canWrite = await this.access.canWrite(report, user);
    const isReviewer = this.access.isReviewer(report, user);
    // A draft belongs to whoever is writing it. Departments share theirs so two
    // people never start the same month; a person's own stays private.
    if (report.status === "draft" && report.createdBy !== user.id) {
      if (report.kind !== "department" || !canWrite) {
        throw new NotFoundException("Report not found");
      }
    }

    const sections = readSections(report.sections, report.template);
    return {
      ...report,
      figures: readFigures(report.figures),
      sections,
      creator: maskUserRef(report.creator, user),
      subjectUser: report.subjectUser ? maskUserRef(report.subjectUser, user) : null,
      reviewer: report.reviewer ? maskUserRef(report.reviewer, user) : null,
      messages: report.messages.map((m) => ({ ...m, author: maskUserRef(m.author, user) })),
      canEdit: EDITABLE.includes(report.status) && canWrite && report.createdBy === user.id,
      canReview: isReviewer && report.status === "submitted",
      missing: missingSections(sections),
      subjectName: base.department?.name ?? report.title,
    };
  }

  /* ---------------- Writing ---------------- */

  /** Opens a report for a period and fills it in from what AIMS recorded. */
  async start(dto: StartReportDto, user: AuthenticatedUser) {
    const kind = dto.kind;
    const template = dto.template ?? TEMPLATE_FOR[kind];
    const subjectId = kind === "individual" ? (dto.subjectId ?? user.id) : dto.subjectId;
    if (!subjectId) throw new BadRequestException("Choose what this report is about");
    if (kind === "individual" && subjectId !== user.id) {
      throw new ForbiddenException("You can only write your own report");
    }

    const subject = await this.access.resolveSubject(kind, subjectId, template);
    if (
      !(await this.access.canWrite({ kind, subjectId, subjectUserId: subject.subjectUserId }, user))
    ) {
      throw new ForbiddenException(this.writeRefusal(kind));
    }

    const fallback = lastMonth();
    const periodStart = dto.periodStart ? new Date(dto.periodStart) : fallback.start;
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : fallback.end;
    this.assertPeriod(periodStart, periodEnd);

    const existing = await this.prisma.report.findFirst({
      where: { kind, subjectId, periodStart, periodEnd },
      include: { creator: { select: USER_REF } },
    });
    if (existing) {
      const who = existing.creator.fullName ?? existing.creator.email;
      throw new BadRequestException(
        existing.createdBy === user.id
          ? "You already started this report — open it instead."
          : `${who} is already preparing this report. Open it and add a comment.`,
      );
    }

    const { figures, lists } = await this.content.build(
      template,
      subjectId,
      periodStart,
      periodEnd,
    );
    const previous = await this.previousFigures(kind, subjectId, periodStart);
    const sections = this.fillSections(templateSections(template), figures, lists);

    const title =
      dto.title?.trim() ||
      `${subject.name} — ${TEMPLATES[template].title.toLowerCase()}, ${monthName(periodStart)}`;

    return this.prisma.report.create({
      data: {
        kind,
        template,
        subjectId,
        departmentId: subject.departmentId,
        subjectUserId: subject.subjectUserId,
        reviewerKind: subject.reviewerKind,
        title,
        periodType: dto.periodType ?? "monthly",
        periodStart,
        periodEnd,
        figures: withPrevious(figures, previous) as unknown as Prisma.InputJsonValue,
        sections: sections as unknown as Prisma.InputJsonValue,
        createdBy: user.id,
      },
    });
  }

  async update(id: string, dto: UpdateReportDto, user: AuthenticatedUser) {
    const report = await this.access.loadReadable(id, user);
    await this.assertCanEdit(report, user);
    if (!EDITABLE.includes(report.status)) {
      throw new BadRequestException(
        "This report is with its reviewer. You can edit it again if changes are asked for.",
      );
    }

    const periodStart = dto.periodStart ? new Date(dto.periodStart) : report.periodStart;
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : report.periodEnd;
    this.assertPeriod(periodStart, periodEnd);

    const sections = dto.sections
      ? (dto.sections as unknown as ReportSection[])
      : readSections(report.sections, report.template);

    if (dto.submit) {
      const missing = missingSections(sections);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Fill in ${missing.join(" and ")} before sending this report.`,
        );
      }
    }

    const wasSentBack = report.status === "changes_requested";
    const updated = await this.prisma.report.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        periodType: dto.periodType,
        periodStart: dto.periodStart ? periodStart : undefined,
        periodEnd: dto.periodEnd ? periodEnd : undefined,
        summary: dto.summary === undefined ? undefined : dto.summary.trim() || null,
        figures: dto.figures ? (dto.figures as unknown as Prisma.InputJsonValue) : undefined,
        sections: dto.sections ? (dto.sections as unknown as Prisma.InputJsonValue) : undefined,
        ...(dto.submit && {
          status: "submitted" as const,
          submittedBy: user.id,
          submittedAt: new Date(),
          submissionCount: report.submissionCount + 1,
        }),
      },
    });
    if (dto.submit) await this.recordSubmission(updated, user, wasSentBack, dto.note);
    return updated;
  }

  /** Pulls the figures again, keeping anything the person changed. */
  async refreshFigures(id: string, user: AuthenticatedUser) {
    const report = await this.access.loadReadable(id, user);
    await this.assertCanEdit(report, user);
    const { figures, lists } = await this.content.build(
      report.template,
      report.subjectId,
      report.periodStart,
      report.periodEnd,
    );
    const previous = await this.previousFigures(report.kind, report.subjectId, report.periodStart);
    const merged = withPrevious(mergeFigures(readFigures(report.figures), figures), previous);
    const sections = this.fillSections(
      readSections(report.sections, report.template),
      merged,
      lists,
      true,
    );
    return this.prisma.report.update({
      where: { id },
      data: {
        figures: merged as unknown as Prisma.InputJsonValue,
        sections: sections as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    const report = await this.access.loadReadable(id, user);
    await this.assertCanEdit(report, user);
    if (report.status !== "draft") {
      throw new BadRequestException("Only a report you haven't sent can be deleted");
    }
    await this.documents.deleteAllForResource("department_report", id);
    await this.prisma.report.delete({ where: { id } });
    return { id };
  }

  /* ---------------- Deciding ---------------- */

  async review(id: string, dto: ReviewReportDto, user: AuthenticatedUser) {
    const report = await this.access.loadReadable(id, user);
    if (!this.access.isReviewer(report, user)) {
      throw new ForbiddenException("This report isn't yours to decide on");
    }
    if (report.status !== "submitted") {
      throw new BadRequestException("Only a report that has been sent can be decided on");
    }
    const approve = dto.decision === "approve";
    const note = dto.note?.trim();
    if (!approve && !note) {
      throw new BadRequestException("Say what needs to change before sending the report back");
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data: {
        status: approve ? "approved" : "changes_requested",
        reviewedBy: user.id,
        reviewedAt: new Date(),
        lastReviewNote: approve ? null : (note ?? null),
      },
    });
    await this.prisma.reportMessage.create({
      data: {
        reportId: id,
        authorId: user.id,
        kind: approve ? "approved" : "changes_requested",
        body: note || "Approved.",
      },
    });
    await this.notifier.notify([report.createdBy, report.submittedBy], {
      type: "report_reviewed",
      title: approve ? `Approved: ${report.title}` : `Changes asked for: ${report.title}`,
      body: note,
      resourceType: "department_report",
      resourceId: id,
      actorId: user.id,
    });
    return updated;
  }

  async addMessage(id: string, dto: ReportMessageDto, user: AuthenticatedUser) {
    const report = await this.access.loadReadable(id, user);
    if (report.status === "draft") {
      throw new BadRequestException("Send the report before starting a conversation");
    }
    if (dto.parentId) {
      const parent = await this.prisma.reportMessage.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.reportId !== id) {
        throw new BadRequestException("You can only reply to a message on this report");
      }
    }
    const body = dto.body.trim();
    const message = await this.prisma.reportMessage.create({
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
    if (this.access.isReviewer(report, user)) {
      await this.notifier.notify([report.createdBy, report.submittedBy], event);
    } else if (report.reviewerKind === "ceo") {
      await this.notifier.toCeo(event);
    } else {
      await this.notifier.notify(await this.headIds(report.departmentId), event);
    }
    return { ...message, author: maskUserRef(message.author, user) };
  }

  /* ---------------- Helpers ---------------- */

  /** Everyone who has to write something for a period, and whether they have. */
  async due(user: AuthenticatedUser) {
    const { start, end } = lastMonth();
    const mine = await this.prisma.report.findFirst({
      where: { kind: "individual", subjectId: user.id, periodStart: start, periodEnd: end },
      select: { id: true, status: true },
    });
    const forReview = await this.prisma.report.count({
      where: {
        status: "submitted",
        ...(isAdminOrCeo(user)
          ? { reviewerKind: "ceo" }
          : { reviewerKind: "department_head", departmentId: user.departmentId ?? "none" }),
      },
    });
    return {
      period: { start, end, label: monthName(start) },
      own: mine ? { id: mine.id, status: mine.status } : null,
      waitingOnMe: forReview,
    };
  }

  private async previousFigures(kind: ReportKind, subjectId: string, periodStart: Date) {
    const before = await this.prisma.report.findFirst({
      where: { kind, subjectId, periodStart: { lt: periodStart } },
      orderBy: { periodStart: "desc" },
      select: { figures: true },
    });
    return before ? readFigures(before.figures) : [];
  }

  /** Puts the pulled-in figures and lists into the sections that hold them. */
  private fillSections(
    sections: ReportSection[],
    figures: ReportFigure[],
    lists: Record<
      string,
      { text: string; source: string; link?: string | null; when?: string | null }[]
    >,
    keepEdits = false,
  ): ReportSection[] {
    return sections.map((s) => {
      if (s.type === "figures") return { ...s, figureKeys: figures.map((f) => f.key) };
      if (s.type !== "list" && s.type !== "risks") return s;
      const pulled = (lists[s.id] ?? []) as ReportSection["items"];
      if (!pulled || pulled.length === 0) return s;
      if (!keepEdits) return { ...s, items: pulled };
      // Keep what the person wrote or kept; add anything new AIMS found.
      const own = (s.items ?? []).filter((i) => i.source !== "aims");
      return { ...s, items: [...pulled, ...own] };
    });
  }

  private async assertCanEdit(
    report: {
      kind: ReportKind;
      subjectId: string;
      subjectUserId: string | null;
      createdBy: string;
    },
    user: AuthenticatedUser,
  ) {
    if (!(await this.access.canWrite(report, user))) {
      throw new ForbiddenException(this.writeRefusal(report.kind));
    }
    if (report.createdBy !== user.id) {
      throw new ForbiddenException(
        "Someone else is writing this report. Add a comment instead, or ask them to hand it over.",
      );
    }
  }

  private writeRefusal(kind: ReportKind) {
    if (kind === "individual") return "You can only write your own report";
    if (kind === "project") return "Only people who can edit this project can report on it";
    return "Only people in this department can prepare its reports";
  }

  private async headIds(departmentId: string | null) {
    if (!departmentId) return [];
    const heads = await this.prisma.user.findMany({
      where: { departmentId, isActive: true, roles: { some: { role: "department_head" } } },
      select: { id: true },
    });
    return heads.map((h) => h.id);
  }

  private async recordSubmission(
    report: {
      id: string;
      title: string;
      reviewerKind: string;
      departmentId: string | null;
    },
    user: AuthenticatedUser,
    resubmitted: boolean,
    note?: string,
  ) {
    await this.prisma.reportMessage.create({
      data: {
        reportId: report.id,
        authorId: user.id,
        kind: resubmitted ? "resubmitted" : "submitted",
        body: note?.trim() || (resubmitted ? "Updated and sent again." : "Sent for your review."),
      },
    });
    const verb = resubmitted ? "sent again" : "sent";
    const event = {
      type: "report_submitted" as const,
      title: `${report.title} was ${verb}`,
      body: note?.trim(),
      resourceType: "department_report" as const,
      resourceId: report.id,
      actorId: user.id,
    };
    if (report.reviewerKind === "ceo") {
      await this.notifier.toCeo(event, `A report was ${verb}: ${report.title}`);
    } else {
      await this.notifier.notify(await this.headIds(report.departmentId), event);
    }
  }

  private assertPeriod(start: Date, end: Date) {
    if (start > end) throw new BadRequestException("The period must end after it starts");
  }
}
