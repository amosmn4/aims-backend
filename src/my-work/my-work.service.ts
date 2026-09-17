import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { canWithCapability } from "../common/permission-resolution";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const DEPARTMENT_CODES = ["finance", "hr", "it", "marketing", "tender", "operations"];
const CLOSED_REQUEST_STAGES = ["won", "lost", "withdrawn"] as const;
const DAY = 86_400_000;

// Everything waiting on one person, for the top of their home page.
@Injectable()
export class MyWorkService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(user: AuthenticatedUser) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soon = new Date(today.getTime() + 7 * DAY);
    const reviewer = isAdminOrCeo(user);

    const [
      tasks,
      overdueCount,
      dueSoonCount,
      openCount,
      requests,
      projects,
      ticketsAssigned,
      ticketsRaised,
      settings,
      reviews,
      reports,
    ] = await Promise.all([
      this.prisma.task.findMany({
        where: { assigneeId: user.id, status: { not: "completed" } },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 8,
      }),
      this.prisma.task.count({
        where: { assigneeId: user.id, status: { not: "completed" }, dueDate: { lt: today } },
      }),
      this.prisma.task.count({
        where: {
          assigneeId: user.id,
          status: { not: "completed" },
          dueDate: { gte: today, lte: soon },
        },
      }),
      this.prisma.task.count({ where: { assigneeId: user.id, status: { not: "completed" } } }),
      this.prisma.clientRequest.findMany({
        where: { assignedToId: user.id, stage: { notIn: [...CLOSED_REQUEST_STAGES] } },
        select: {
          id: true,
          title: true,
          referenceNumber: true,
          stage: true,
          stageChangedAt: true,
          prospectClientName: true,
          client: { select: { name: true } },
        },
        orderBy: { stageChangedAt: "asc" },
        take: 6,
      }),
      this.prisma.project.findMany({
        where: {
          OR: [{ createdBy: user.id }, { team: { some: { userId: user.id } } }],
          status: { notIn: ["completed", "cancelled"] },
          AND: [{ OR: [{ health: { in: ["amber", "red"] } }, { endDate: { lt: today } }] }],
        },
        select: {
          id: true,
          name: true,
          health: true,
          endDate: true,
          department: { select: { code: true } },
        },
        orderBy: { endDate: { sort: "asc", nulls: "last" } },
        take: 5,
      }),
      this.prisma.ticket.findMany({
        where: { assigneeId: user.id, status: { in: ["open", "in_progress"] } },
        select: { id: true, title: true, status: true, priority: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      }),
      this.prisma.ticket.count({
        where: { requesterId: user.id, status: { in: ["open", "in_progress"] } },
      }),
      this.prisma.companySettings.findUnique({
        where: { id: "company" },
        select: { reportDueDay: true },
      }),
      reviewer
        ? Promise.all([
            this.prisma.departmentReport.count({ where: { status: "submitted" } }),
            this.prisma.financeReport.count({ where: { status: "submitted" } }),
          ])
        : Promise.resolve(null),
      reviewer ? Promise.resolve([]) : this.reportsDue(user, now),
    ]);

    const dueDay = settings?.reportDueDay ?? 5;
    return {
      tasks: {
        open: openCount,
        overdue: overdueCount,
        dueSoon: dueSoonCount,
        items: tasks.map((t) => ({ ...t, overdue: !!t.dueDate && t.dueDate < today })),
      },
      requests: requests.map(({ client, prospectClientName, ...r }) => ({
        ...r,
        clientName: client?.name ?? prospectClientName ?? null,
        daysInStage: Math.floor((now.getTime() - r.stageChangedAt.getTime()) / DAY),
      })),
      projects: projects.map((p) => ({ ...p, late: !!p.endDate && p.endDate < today })),
      tickets: { assigned: ticketsAssigned, raisedOpen: ticketsRaised },
      reports: reports.map((r) => ({ ...r, dueDate: this.dueDate(now, dueDay) })),
      reviews: reviews ? { waiting: reviews[0] + reviews[1] } : null,
    };
  }

  /** Last month's report for each department this person reports for. */
  private async reportsDue(user: AuthenticatedUser, now: Date) {
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const departments = await this.prisma.department.findMany({
      where: { code: { in: DEPARTMENT_CODES } },
      select: { id: true, name: true, code: true },
    });
    const mine = [];
    for (const d of departments) {
      if (await canWithCapability(user, d, "submit_reports", this.prisma)) mine.push(d);
    }
    if (mine.length === 0) return [];
    const existing = await this.prisma.departmentReport.findMany({
      where: { departmentId: { in: mine.map((d) => d.id) }, periodStart: { gte: start, lt: end } },
      select: { id: true, departmentId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    const period = start.toISOString().slice(0, 7);
    const financeReport = mine.some((d) => d.code === "finance")
      ? await this.prisma.financeReport.findFirst({
          where: { periodStart: { gte: start, lt: end } },
          select: { id: true, status: true },
          orderBy: { updatedAt: "desc" },
        })
      : null;
    return mine.map((d) => {
      const report = existing.find((r) => r.departmentId === d.id);
      const finance = d.code === "finance" && !report ? financeReport : null;
      return {
        departmentId: d.id,
        departmentName: d.name,
        departmentCode: d.code,
        period,
        status: report?.status ?? finance?.status ?? "not_started",
        reportId: report?.id ?? null,
        financeReportId: finance?.id ?? null,
      };
    });
  }

  private dueDate(now: Date, dueDay: number) {
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), dueDay)).toISOString().slice(0, 10);
  }
}
