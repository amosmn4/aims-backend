import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../notifications/email/email.service";
import {
  REPORT_EMAIL_DEFAULTS,
  emailTable,
  escapeHtml,
  type ReportEmailKey,
} from "./report-email.util";

const TIME_ZONE = "Africa/Nairobi";
const monthName = (d: Date) => d.toLocaleString("en-GB", { month: "long", year: "numeric" });
const money = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

function previousMonth(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
  return { start, end };
}

@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  /** Reminds departments before the due day and tells the CEO about late reports. */
  @Cron("0 8 * * *", { timeZone: TIME_ZONE })
  async remindDueReports(today = new Date()) {
    const settings = await this.prisma.companySettings.findUnique({ where: { id: "company" } });
    if (settings?.reportRemindersEnabled === false) return;
    const dueDay = settings?.reportDueDay ?? 5;
    const day = today.getDate();
    if (![dueDay - 3, dueDay, dueDay + 1].includes(day)) return;
    const { start, end } = previousMonth(today);
    const label = monthName(start);
    const dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay).toLocaleDateString(
      "en-GB",
      {
        day: "numeric",
        month: "long",
      },
    );

    for (const dept of await this.missingMonthlyReports(start, end)) {
      if (day === dueDay + 1) {
        for (const userId of await this.ceoIds()) {
          await this.notifications.notify({
            userId,
            type: "report_due",
            severity: "warning",
            title: `${dept.name} hasn't submitted its ${label} report`,
            body: `It was due on ${dueDate}.`,
            resourceType: "reports_inbox",
            resourceId: dept.code,
          });
        }
        continue;
      }
      const writers = await this.prisma.user.findMany({
        where: {
          isActive: true,
          roles: { some: { role: dept.code as Prisma.EnumAppRoleFilter["equals"] } },
        },
        select: { id: true },
      });
      for (const w of writers) {
        await this.notifications.notify({
          userId: w.id,
          type: "report_due",
          severity: day === dueDay ? "warning" : "info",
          title: `${dept.name} report for ${label} is due ${day === dueDay ? "today" : `on ${dueDate}`}`,
          body: "Open Reports in your department, prepare the report and submit it to the CEO.",
          resourceType: "department_reports",
          resourceId: dept.code,
        });
      }
    }

    await this.remindOwnReports(start, end, label, dueDate, day === dueDay);
    await this.remindReviewers(label);
  }

  /** Nudges each person about their own report. Reminded, never blocked. */
  private async remindOwnReports(
    start: Date,
    end: Date,
    label: string,
    dueDate: string,
    dueToday: boolean,
  ) {
    const [staff, written] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, departmentId: { not: null } },
        select: { id: true },
      }),
      this.prisma.report.findMany({
        where: {
          kind: "individual",
          periodStart: { gte: start, lte: end },
          NOT: { status: "draft" },
        },
        select: { subjectId: true },
      }),
    ]);
    const done = new Set(written.map((r) => r.subjectId));
    for (const person of staff) {
      if (done.has(person.id)) continue;
      await this.notifications.notify({
        userId: person.id,
        type: "report_due",
        severity: "info",
        title: `Your own ${label} report is due ${dueToday ? "today" : `on ${dueDate}`}`,
        body: "AIMS has your figures ready — it takes about five minutes.",
        resourceType: "my_reports",
        resourceId: start.toISOString().slice(0, 7),
      });
    }
  }

  /** Tells each department head how many of their people are waiting on them. */
  private async remindReviewers(label: string) {
    const waiting = await this.prisma.report.groupBy({
      by: ["departmentId"],
      where: { status: "submitted", reviewerKind: "department_head" },
      _count: true,
    });
    for (const row of waiting) {
      if (!row.departmentId || row._count === 0) continue;
      const heads = await this.prisma.user.findMany({
        where: {
          departmentId: row.departmentId,
          isActive: true,
          roles: { some: { role: "department_head" } },
        },
        select: { id: true },
      });
      for (const head of heads) {
        await this.notifications.notify({
          userId: head.id,
          type: "report_due",
          severity: "info",
          title: `${row._count} ${label} report${row._count === 1 ? "" : "s"} waiting on you`,
          body: "Read them and approve, or send one back saying what needs to change.",
          resourceType: "team_reports",
          resourceId: row.departmentId,
        });
      }
    }
  }

  @Cron("0 7 1 * *", { timeZone: TIME_ZONE })
  async sendMonthlyEmails(today = new Date()) {
    const { start, end } = previousMonth(today);
    await this.sendTo(
      "board_pack",
      `Board pack — ${monthName(start)}`,
      await this.boardPackHtml(start, end),
    );
    await this.sendTo(
      "water_monthly",
      `Water Project — ${monthName(start)}`,
      await this.waterHtml(start, end),
    );
  }

  @Cron("0 7 * * 1", { timeZone: TIME_ZONE })
  async sendPipelineSummary() {
    await this.sendTo("pipeline_weekly", "Weekly pipeline summary", await this.pipelineHtml());
  }

  @Cron("0 7 * * 5", { timeZone: TIME_ZONE })
  async sendDebtors(today = new Date()) {
    const week = Math.ceil(
      ((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / 864e5 + 1) / 7,
    );
    if (week % 2 !== 0) return;
    await this.sendTo("debtors_fortnightly", "Debtors ageing", await this.debtorsHtml());
  }

  private async missingMonthlyReports(start: Date, end: Date) {
    const departments = await this.prisma.department.findMany({
      where: { isActive: true, isCore: true },
    });
    const [deptReports, financeReports] = await Promise.all([
      this.prisma.report.findMany({
        where: {
          kind: "department",
          periodType: "monthly",
          periodStart: { gte: start, lte: end },
          NOT: { status: "draft" },
        },
        select: { departmentId: true },
      }),
      this.prisma.financeReport.count({
        where: {
          reportType: "monthly_financial",
          periodStart: { gte: start, lte: end },
          NOT: { status: "draft" },
        },
      }),
    ]);
    const done = new Set(deptReports.map((r) => r.departmentId));
    return departments.filter((d) =>
      d.code === "finance" ? financeReports === 0 && !done.has(d.id) : !done.has(d.id),
    );
  }

  private ceoIds() {
    return this.prisma.user
      .findMany({
        where: { isActive: true, roles: { some: { role: "ceo" } } },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));
  }

  private async sendTo(key: ReportEmailKey, subject: string, html: string) {
    const ceos = await this.prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: "ceo" } } },
      select: {
        email: true,
        fullName: true,
        reportEmailSubscriptions: { where: { reportKey: key } },
      },
    });
    for (const ceo of ceos) {
      if (!(ceo.reportEmailSubscriptions[0]?.enabled ?? REPORT_EMAIL_DEFAULTS[key])) continue;
      const sent = await this.email.send(
        ceo.email,
        subject,
        `<p>Hello ${escapeHtml(ceo.fullName ?? "")},</p>${html}`,
      );
      if (!sent) this.logger.warn(`Could not send "${subject}"`);
    }
  }

  private async boardPackHtml(start: Date, end: Date) {
    const inMonth = { gte: start, lte: end };
    const [departments, reports, finance] = await Promise.all([
      this.prisma.department.findMany({
        where: { isActive: true, isCore: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.report.findMany({
        where: { kind: "department", status: "approved", periodEnd: inMonth },
      }),
      this.prisma.financeReport.findMany({ where: { status: "approved", periodEnd: inMonth } }),
    ]);
    const sections = departments.map((d) => {
      const own = reports.filter((r) => r.departmentId === d.id);
      const fin = d.code === "finance" ? finance : [];
      if (own.length === 0 && fin.length === 0) {
        return `<h3>${escapeHtml(d.name)}</h3><p style="color:#b45309">No approved report for this month.</p>`;
      }
      const parts = own.map((r) => {
        const figures = (r.figures as { label: string; value: string }[]).map(
          (f) => [f.label, f.value] as [string, string],
        );
        return `<p><b>${escapeHtml(r.title)}</b></p>${emailTable(figures)}${r.summary ? `<p>${escapeHtml(r.summary)}</p>` : ""}`;
      });
      const finParts = fin.map(
        (r) =>
          `<p><b>${escapeHtml(r.title)}</b></p>${r.narrative ? `<p>${escapeHtml(r.narrative)}</p>` : ""}`,
      );
      return `<h3>${escapeHtml(d.name)}</h3>${[...parts, ...finParts].join("")}`;
    });
    return `<p>Here is the board pack for ${monthName(start)}, built from the reports you approved.</p>${sections.join("")}`;
  }

  private async pipelineHtml() {
    const soon = new Date(Date.now() + 7 * 864e5);
    const [requests, bids, closing, delivery] = await Promise.all([
      this.prisma.clientRequest.count({
        where: { stage: { notIn: ["won", "lost", "withdrawn"] } },
      }),
      this.prisma.tender.count({
        where: { stage: { in: ["identified", "applying", "submitted"] } },
      }),
      this.prisma.tender.count({
        where: {
          stage: { in: ["identified", "applying"] },
          submissionDeadline: { gte: new Date(), lte: soon },
        },
      }),
      this.prisma.project.count({
        where: {
          deliveryStage: { not: "closed" },
          status: { in: ["planning", "active", "on_hold"] },
        },
      }),
    ]);
    return `<p>This week's pipeline:</p>${emailTable([
      ["Open client requests", String(requests)],
      ["Open bids", String(bids)],
      ["Bids closing in the next 7 days", String(closing)],
      ["Projects in delivery", String(delivery)],
    ])}`;
  }

  private async debtorsHtml() {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { notIn: ["paid", "void", "cancelled"] } },
      select: {
        total: true,
        dueDate: true,
        client: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    });
    const now = Date.now();
    let total = 0;
    let over90 = 0;
    const byClient = new Map<string, number>();
    for (const inv of invoices) {
      const due = Number(inv.total) - inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      if (due <= 0) continue;
      total += due;
      if ((now - inv.dueDate.getTime()) / 864e5 > 90) over90 += due;
      byClient.set(inv.client.name, (byClient.get(inv.client.name) ?? 0) + due);
    }
    const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return `<p>Money owed to the company:</p>${emailTable([
      ["Outstanding", money(total)],
      ["More than 90 days overdue", money(over90)],
      ...top.map(([name, amount]) => [name, money(amount)] as [string, string]),
    ])}`;
  }

  private async waterHtml(start: Date, end: Date) {
    const [usage, active, inactive] = await Promise.all([
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: start, lte: end } },
        _sum: { unitsSold: true, amountPaid: true },
      }),
      this.prisma.waterMeter.count({ where: { isActive: true } }),
      this.prisma.waterMeter.count({ where: { isActive: false } }),
    ]);
    return `<p>Water Project for ${monthName(start)}:</p>${emailTable([
      ["Units sold", `${Number(usage._sum.unitsSold ?? 0).toLocaleString("en-KE")} m³`],
      ["Revenue", money(Number(usage._sum.amountPaid ?? 0))],
      ["Active meters", String(active)],
      ["Inactive meters (not in use)", String(inactive)],
    ])}`;
  }
}
