import { Injectable } from "@nestjs/common";
import type { ReportTemplate } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { aimsFigure, share, type ReportFigure } from "./report-figures";
import type { ReportListItem } from "./report-sections";

type Period = { gte: Date; lte: Date };

export interface ReportContent {
  figures: ReportFigure[];
  /** Section id → the lines AIMS pulled in for it. */
  lists: Record<string, ReportListItem[]>;
}

const empty: ReportContent = { figures: [], lists: {} };
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Works out what a report should say, from what AIMS already recorded for the
 * period. Every figure comes back marked as the system's, so an edit stays visible.
 */
@Injectable()
export class ReportContentService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    template: ReportTemplate,
    subjectId: string,
    from: Date,
    to: Date,
  ): Promise<ReportContent> {
    const period: Period = { gte: from, lte: to };
    switch (template) {
      case "department_monthly":
        return this.department(subjectId, period);
      case "project_progress":
        return this.project(subjectId, period, false);
      case "project_completion":
        return this.project(subjectId, period, true);
      case "individual_period":
        return this.individual(subjectId, period);
      default:
        return empty;
    }
  }

  /* ---------------- Departments ---------------- */

  private async department(departmentId: string, period: Period): Promise<ReportContent> {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) return empty;
    const figures = await this.departmentFigures(department.code, departmentId, period);
    const lists = { highlights: await this.departmentHighlights(departmentId, period) };
    return { figures, lists };
  }

  private departmentFigures(code: string, departmentId: string, period: Period) {
    switch (code) {
      case "finance":
        return this.finance(period);
      case "hr":
        return this.hr(departmentId, period);
      case "it":
        return this.it(period);
      case "marketing":
        return this.marketing(period);
      case "tender":
        return this.tender(period);
      case "operations":
        return this.operations(period);
      default:
        return this.departmentProjects(departmentId, period);
    }
  }

  private async finance(period: Period): Promise<ReportFigure[]> {
    const [issued, payments, open] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { issueDate: period, NOT: { status: "void" } },
        _sum: { subtotal: true },
        _count: true,
      }),
      this.prisma.invoicePayment.aggregate({ where: { paidOn: period }, _sum: { amount: true } }),
      this.prisma.invoice.findMany({
        where: { status: { notIn: ["paid", "void", "cancelled"] } },
        select: { total: true, dueDate: true, payments: { select: { amount: true } } },
      }),
    ]);
    let outstanding = 0;
    let overdue = 0;
    const now = new Date();
    for (const inv of open) {
      const due = Number(inv.total) - inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      if (due <= 0) continue;
      outstanding += due;
      if (inv.dueDate < now) overdue += 1;
    }
    return [
      aimsFigure(
        "revenue_invoiced",
        "Revenue invoiced (excl. VAT)",
        Number(issued._sum.subtotal ?? 0),
        "money",
      ),
      aimsFigure("invoices_issued", "Invoices issued", issued._count, "count"),
      aimsFigure("cash_collected", "Cash collected", Number(payments._sum.amount ?? 0), "money"),
      aimsFigure("outstanding", "Outstanding today", outstanding, "money"),
      aimsFigure("overdue_invoices", "Overdue invoices", overdue, "count"),
    ];
  }

  private async hr(departmentId: string, period: Period): Promise<ReportFigure[]> {
    const [active, completed, placements, funnels, recurring] = await Promise.all([
      this.prisma.project.count({ where: { departmentId, status: "active" } }),
      this.prisma.project.count({ where: { departmentId, completedAt: period } }),
      this.prisma.recruitmentPlacement.count({
        where: { project: { departmentId }, placedAt: period },
      }),
      this.prisma.recruitmentFunnel.aggregate({
        where: { project: { departmentId }, updatedAt: period },
        _sum: { applicationsReceived: true },
      }),
      this.prisma.project.findMany({
        where: {
          departmentId,
          engagementType: "ongoing",
          status: "active",
          clientId: { not: null },
        },
        select: { clientId: true },
        distinct: ["clientId"],
      }),
    ]);
    return [
      aimsFigure("active_projects", "Active projects", active, "count"),
      aimsFigure("projects_completed", "Projects completed", completed, "count"),
      aimsFigure("people_placed", "People placed", placements, "count"),
      aimsFigure(
        "applications_received",
        "Applications received",
        funnels._sum.applicationsReceived ?? 0,
        "count",
      ),
      aimsFigure("recurring_clients", "Recurring clients", recurring.length, "count"),
    ];
  }

  private async it(period: Period): Promise<ReportFigure[]> {
    const [users, opened, resolved, open, systems] = await Promise.all([
      this.prisma.hrmsLicense.aggregate({
        where: { status: "active" },
        _sum: { activeUsers: true },
      }),
      this.prisma.ticket.count({ where: { createdAt: period } }),
      this.prisma.ticket.count({ where: { OR: [{ resolvedAt: period }, { closedAt: period }] } }),
      this.prisma.ticket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      this.prisma.itSystem.count({ where: { status: "active" } }),
    ]);
    return [
      aimsFigure("hrms_active_users", "HRMS active users", users._sum.activeUsers ?? 0, "count"),
      aimsFigure("tickets_opened", "Tickets opened", opened, "count"),
      aimsFigure("tickets_resolved", "Tickets resolved", resolved, "count"),
      aimsFigure("tickets_open", "Tickets still open", open, "count"),
      aimsFigure("systems_live", "Systems live", systems, "count"),
    ];
  }

  private async marketing(period: Period): Promise<ReportFigure[]> {
    const [leads, converted, campaigns, visits] = await Promise.all([
      this.prisma.lead.count({ where: { createdAt: period } }),
      this.prisma.lead.count({
        where: { stage: "converted", convertedRequest: { createdAt: period } },
      }),
      this.prisma.campaign.count({ where: { status: "active" } }),
      this.prisma.websiteAnalyticsSnapshot.findFirst({ orderBy: { periodEnd: "desc" } }),
    ]);
    return [
      aimsFigure("new_leads", "New leads", leads, "count"),
      aimsFigure("leads_converted", "Leads turned into client requests", converted, "count"),
      aimsFigure("lead_conversion", "Lead conversion", share(converted, leads), "percent"),
      aimsFigure("campaigns_running", "Campaigns running", campaigns, "count"),
      aimsFigure(
        "website_visitors",
        "Website visitors (last 30 days)",
        visits ? visits.visitors : null,
        visits ? "count" : "text",
      ),
    ];
  }

  private async tender(period: Period): Promise<ReportFigure[]> {
    const [submitted, won, lost, open] = await Promise.all([
      this.prisma.tender.count({ where: { submittedAt: period } }),
      this.prisma.tender.findMany({ where: { wonAt: period }, select: { estimatedValue: true } }),
      this.prisma.tender.count({ where: { stage: "lost", lostAt: period } }),
      this.prisma.tender.count({
        where: { stage: { in: ["identified", "applying", "submitted"] } },
      }),
    ]);
    const wonValue = won.reduce((s, t) => s + Number(t.estimatedValue ?? 0), 0);
    return [
      aimsFigure("bids_submitted", "Bids submitted", submitted, "count"),
      aimsFigure("bids_won", "Bids awarded", won.length, "count"),
      aimsFigure("bids_lost", "Bids not awarded", lost, "count"),
      aimsFigure("win_rate", "Win rate", share(won.length, won.length + lost), "percent"),
      aimsFigure("value_won", "Value won", wonValue, "money"),
      aimsFigure("bids_open", "Bids still open", open, "count"),
    ];
  }

  private async operations(period: Period): Promise<ReportFigure[]> {
    const moved = (to: string[]) =>
      this.prisma.stageChange
        .findMany({
          where: { entityType: "client_request", toStage: { in: to }, changedAt: period },
          select: { entityId: true },
          distinct: ["entityId"],
        })
        .then((rows) => rows.length);
    const [logged, won, lost] = await Promise.all([
      this.prisma.clientRequest.count({ where: { createdAt: period } }),
      moved(["won"]),
      moved(["lost", "withdrawn"]),
    ]);
    return [
      aimsFigure("requests_logged", "Client requests logged", logged, "count"),
      aimsFigure("requests_won", "Requests won", won, "count"),
      aimsFigure("requests_lost", "Requests lost or withdrawn", lost, "count"),
      aimsFigure("request_conversion", "Conversion", share(won, won + lost), "percent"),
    ];
  }

  private async departmentProjects(departmentId: string, period: Period): Promise<ReportFigure[]> {
    const [active, completed] = await Promise.all([
      this.prisma.project.count({ where: { departmentId, status: "active" } }),
      this.prisma.project.count({ where: { departmentId, completedAt: period } }),
    ]);
    return [
      aimsFigure("active_projects", "Active projects", active, "count"),
      aimsFigure("projects_completed", "Projects completed", completed, "count"),
    ];
  }

  private async departmentHighlights(departmentId: string, period: Period) {
    const [completed, milestones] = await Promise.all([
      this.prisma.project.findMany({
        where: { departmentId, completedAt: period },
        select: { id: true, name: true, completedAt: true },
        take: 10,
      }),
      this.prisma.milestone.findMany({
        where: { project: { departmentId }, isComplete: true, updatedAt: period },
        select: { id: true, title: true, projectId: true, dueDate: true },
        take: 10,
      }),
    ]);
    return [
      ...completed.map((p) => ({
        text: `Completed ${p.name}`,
        source: "aims" as const,
        link: `/projects/${p.id}`,
        when: day(p.completedAt),
      })),
      ...milestones.map((m) => ({
        text: `Milestone reached: ${m.title}`,
        source: "aims" as const,
        link: `/projects/${m.projectId}`,
        when: day(m.dueDate),
      })),
    ];
  }

  /* ---------------- Projects ---------------- */

  private async project(projectId: string, period: Period, whole: boolean): Promise<ReportContent> {
    const window = whole ? undefined : period;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        budget: true,
        health: true,
        deliveryStage: true,
        completedAt: true,
      },
    });
    if (!project) return empty;

    const [milestones, tasks, costs, raid, extensions, stages] = await Promise.all([
      this.prisma.milestone.findMany({
        where: { projectId },
        select: { id: true, title: true, dueDate: true, isComplete: true, updatedAt: true },
        orderBy: { dueDate: "asc" },
      }),
      this.prisma.task.findMany({
        where: { projectId },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          updatedAt: true,
          estimatedHours: true,
          actualHours: true,
        },
      }),
      this.prisma.projectCostItem.findMany({
        where: { projectId },
        select: { category: true, budgetedAmount: true, actualAmount: true },
      }),
      this.prisma.projectRaidEntry.findMany({
        where: { projectId, status: "open" },
        select: { id: true, type: true, description: true, severity: true, mitigation: true },
        orderBy: { severity: "desc" },
      }),
      this.prisma.timelineExtension.findMany({
        where: { entityType: "project", entityId: projectId },
        select: { previousDate: true, newDate: true, reason: true, attributedTo: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.stageChange.findMany({
        where: {
          entityType: "project",
          entityId: projectId,
          ...(window && { changedAt: window }),
        },
        select: { fromStage: true, toStage: true, changedAt: true },
        orderBy: { changedAt: "asc" },
      }),
    ]);

    const inWindow = (d: Date | null) => !window || (!!d && d >= window.gte && d <= window.lte);
    const doneMilestones = milestones.filter((m) => m.isComplete);
    const lateMilestones = milestones.filter(
      (m) => !m.isComplete && m.dueDate && m.dueDate < new Date(),
    );
    const doneTasks = tasks.filter((t) => t.status === "completed");
    const openTasks = tasks.filter((t) => t.status !== "completed");
    const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < new Date());
    const budgeted = costs.reduce((s, c) => s + Number(c.budgetedAmount ?? 0), 0);
    const spent = costs.reduce((s, c) => s + Number(c.actualAmount ?? 0), 0);
    const plannedBudget = Number(project.budget ?? 0) || budgeted;
    const estimated = tasks.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0);
    const actual = tasks.reduce((s, t) => s + Number(t.actualHours ?? 0), 0);
    const slipDays = extensions.reduce(
      (s, e) => s + Math.round((e.newDate.getTime() - e.previousDate.getTime()) / 86_400_000),
      0,
    );

    const figures: ReportFigure[] = [
      aimsFigure("milestones_done", "Milestones complete", doneMilestones.length, "count"),
      aimsFigure("milestones_total", "Milestones in total", milestones.length, "count"),
      aimsFigure("milestones_late", "Milestones past their date", lateMilestones.length, "count"),
      aimsFigure("tasks_done", "Tasks finished", doneTasks.length, "count"),
      aimsFigure("tasks_open", "Tasks still open", openTasks.length, "count"),
      aimsFigure("tasks_overdue", "Tasks overdue", overdueTasks.length, "count"),
      aimsFigure(
        "work_done_pct",
        "Work done",
        share(doneMilestones.length, milestones.length),
        "percent",
      ),
      aimsFigure("budget_planned", "Budget", plannedBudget, "money"),
      aimsFigure("budget_spent", "Spent so far", spent, "money"),
      aimsFigure("budget_used_pct", "Budget used", share(spent, plannedBudget), "percent"),
      aimsFigure("hours_estimated", "Hours estimated", estimated, "hours"),
      aimsFigure("hours_actual", "Hours logged", actual, "hours"),
      aimsFigure("days_slipped", "Days the end date moved", slipDays, "days"),
      aimsFigure("risks_open", "Risks and issues open", raid.length, "count"),
      aimsFigure("health", "Health", project.health ? project.health.toUpperCase() : null, "text"),
    ];

    if (whole) {
      figures.push(
        aimsFigure("budget_variance", "Over or under budget", spent - plannedBudget, "money"),
        aimsFigure("finished_on", "Finished on", day(project.completedAt), "text"),
      );
    }

    const lists: Record<string, ReportListItem[]> = {
      done: [
        ...doneMilestones
          .filter((m) => inWindow(m.updatedAt))
          .map((m) => ({
            text: `Milestone: ${m.title}`,
            source: "aims" as const,
            when: day(m.dueDate),
          })),
        ...doneTasks
          .filter((t) => inWindow(t.updatedAt))
          .slice(0, 20)
          .map((t) => ({ text: t.title, source: "aims" as const, when: day(t.updatedAt) })),
      ],
      slipped: [
        ...lateMilestones.map((m) => ({
          text: `${m.title} — was due ${day(m.dueDate)}`,
          source: "aims" as const,
          when: day(m.dueDate),
        })),
        ...stages.map((s) => ({
          text: `Moved from ${s.fromStage ?? "—"} to ${s.toStage}`,
          source: "aims" as const,
          when: day(s.changedAt),
        })),
      ],
      risks: raid.map((r) => ({
        text: `${r.severity.toUpperCase()} ${r.type}: ${r.description}${r.mitigation ? ` — ${r.mitigation}` : ""}`,
        source: "aims" as const,
        link: `/projects/${projectId}`,
      })),
      slippage: extensions.map((e) => ({
        text: `${day(e.previousDate)} → ${day(e.newDate)} · ${e.reason} · down to ${e.attributedTo}`,
        source: "aims" as const,
        when: day(e.newDate),
      })),
      open: openTasks
        .slice(0, 20)
        .map((t) => ({ text: t.title, source: "aims" as const, when: day(t.dueDate) })),
      delivered: doneMilestones.map((m) => ({
        text: m.title,
        source: "aims" as const,
        when: day(m.dueDate),
      })),
    };

    return { figures, lists };
  }

  /* ---------------- People ---------------- */

  private async individual(userId: string, period: Period): Promise<ReportContent> {
    const [tasks, ticketsResolved, ticketsRaised, requests, memberships] = await Promise.all([
      this.prisma.task.findMany({
        where: { assigneeId: userId },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          updatedAt: true,
          actualHours: true,
          projectId: true,
          project: { select: { name: true } },
        },
      }),
      this.prisma.ticket.findMany({
        where: { assigneeId: userId, OR: [{ resolvedAt: period }, { closedAt: period }] },
        select: { id: true, title: true, resolvedAt: true, closedAt: true },
      }),
      this.prisma.ticket.count({ where: { requesterId: userId, createdAt: period } }),
      this.prisma.clientRequest.findMany({
        where: { assignedToId: userId, updatedAt: period },
        select: { id: true, title: true, referenceNumber: true, stage: true },
        take: 20,
      }),
      this.prisma.projectTeamMember.findMany({
        where: { userId },
        select: { projectId: true, hoursLogged: true, project: { select: { name: true } } },
      }),
    ]);

    const finished = tasks.filter(
      (t) => t.status === "completed" && t.updatedAt >= period.gte && t.updatedAt <= period.lte,
    );
    const open = tasks.filter((t) => t.status !== "completed");
    const overdue = open.filter((t) => t.dueDate && t.dueDate < new Date());
    const hoursFromTasks = finished.reduce((s, t) => s + Number(t.actualHours ?? 0), 0);
    const hoursFromTeams = memberships.reduce((s, m) => s + Number(m.hoursLogged ?? 0), 0);

    const figures: ReportFigure[] = [
      aimsFigure("tasks_finished", "Tasks finished", finished.length, "count"),
      aimsFigure("tasks_open", "Still open at period end", open.length, "count"),
      aimsFigure("tasks_overdue", "Overdue right now", overdue.length, "count"),
      aimsFigure("tickets_resolved", "Tickets resolved", ticketsResolved.length, "count"),
      aimsFigure("tickets_raised", "Tickets you raised", ticketsRaised, "count"),
      aimsFigure("requests_handled", "Client requests handled", requests.length, "count"),
      aimsFigure("hours_logged", "Hours logged", hoursFromTasks || hoursFromTeams, "hours"),
      aimsFigure("projects_worked_on", "Projects worked on", memberships.length, "count"),
    ];

    const lists: Record<string, ReportListItem[]> = {
      done: [
        ...finished.slice(0, 20).map((t) => ({
          text: t.project?.name ? `${t.title} — ${t.project.name}` : t.title,
          source: "aims" as const,
          link: t.projectId ? `/projects/${t.projectId}` : null,
          when: day(t.updatedAt),
        })),
        ...ticketsResolved.slice(0, 10).map((t) => ({
          text: `Resolved: ${t.title}`,
          source: "aims" as const,
          link: `/it/tickets?ticket=${t.id}`,
          when: day(t.resolvedAt ?? t.closedAt),
        })),
        ...requests.slice(0, 10).map((r) => ({
          text: `${r.referenceNumber} ${r.title} — now ${r.stage}`,
          source: "aims" as const,
          link: `/requests/${r.id}`,
        })),
      ],
    };

    return { figures, lists };
  }
}
