import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { can } from "../common/permission-resolution";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

type Figure = { label: string; value: string };

const count = (n: number) => n.toLocaleString("en-KE");
const money = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/** Proposes a report's figures from what the department already recorded in AIMS. */
@Injectable()
export class SuggestedFiguresService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(
    departmentId: string,
    start: string,
    end: string,
    user: AuthenticatedUser,
  ): Promise<Figure[]> {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) throw new NotFoundException("Department not found");
    if (!(await can(user, department, "read", this.prisma)))
      throw new NotFoundException("Department not found");
    const from = new Date(start);
    const to = new Date(end);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException("Choose a valid period");
    }
    to.setHours(23, 59, 59, 999);
    const period = { gte: from, lte: to };

    switch (department.code) {
      case "finance":
        return this.finance(period);
      case "hr":
        return this.hr(department.id, period);
      case "it":
        return this.it(period);
      case "marketing":
        return this.marketing(period);
      case "tender":
        return this.tender(period);
      case "operations":
        return this.operations(period);
      default:
        return this.projects(department.id, period);
    }
  }

  private async finance(period: { gte: Date; lte: Date }): Promise<Figure[]> {
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
    for (const inv of open) {
      const due = Number(inv.total) - inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      if (due <= 0) continue;
      outstanding += due;
      if (inv.dueDate < new Date()) overdue += 1;
    }
    return [
      { label: "Revenue invoiced (excl. VAT)", value: money(Number(issued._sum.subtotal ?? 0)) },
      { label: "Invoices issued", value: count(issued._count) },
      { label: "Cash collected", value: money(Number(payments._sum.amount ?? 0)) },
      { label: "Outstanding today", value: money(outstanding) },
      { label: "Overdue invoices", value: count(overdue) },
    ];
  }

  private async hr(departmentId: string, period: { gte: Date; lte: Date }): Promise<Figure[]> {
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
      { label: "Active projects", value: count(active) },
      { label: "Projects completed", value: count(completed) },
      { label: "People placed", value: count(placements) },
      { label: "Applications received", value: count(funnels._sum.applicationsReceived ?? 0) },
      { label: "Recurring clients", value: count(recurring.length) },
    ];
  }

  private async it(period: { gte: Date; lte: Date }): Promise<Figure[]> {
    const [users, opened, resolved, open, systems] = await Promise.all([
      this.prisma.hrmsLicense.aggregate({
        where: { status: "active" },
        _sum: { activeUsers: true },
      }),
      this.prisma.ticket.count({ where: { createdAt: period } }),
      this.prisma.ticket.count({ where: { OR: [{ resolvedAt: period }, { closedAt: period }] } }),
      this.prisma.ticket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      this.prisma.itSystem.count(),
    ]);
    return [
      { label: "HRMS active users", value: count(users._sum.activeUsers ?? 0) },
      { label: "Tickets opened", value: count(opened) },
      { label: "Tickets resolved", value: count(resolved) },
      { label: "Tickets still open", value: count(open) },
      { label: "Systems looked after", value: count(systems) },
    ];
  }

  private async marketing(period: { gte: Date; lte: Date }): Promise<Figure[]> {
    const [leads, converted, campaigns, visits] = await Promise.all([
      this.prisma.lead.count({ where: { createdAt: period } }),
      this.prisma.lead.count({
        where: { stage: "converted", convertedRequest: { createdAt: period } },
      }),
      this.prisma.campaign.count({ where: { status: "active" } }),
      this.prisma.websiteAnalyticsSnapshot.findFirst({ orderBy: { periodEnd: "desc" } }),
    ]);
    return [
      { label: "New leads", value: count(leads) },
      { label: "Leads turned into client requests", value: count(converted) },
      { label: "Lead conversion", value: pct(converted, leads) },
      { label: "Campaigns running", value: count(campaigns) },
      {
        label: "Website visitors (last 30 days)",
        value: visits ? count(visits.visitors) : "Not connected",
      },
    ];
  }

  private async tender(period: { gte: Date; lte: Date }): Promise<Figure[]> {
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
      { label: "Bids submitted", value: count(submitted) },
      { label: "Bids awarded", value: count(won.length) },
      { label: "Bids not awarded", value: count(lost) },
      { label: "Win rate", value: pct(won.length, won.length + lost) },
      { label: "Value won", value: money(wonValue) },
      { label: "Bids still open", value: count(open) },
    ];
  }

  private async operations(period: { gte: Date; lte: Date }): Promise<Figure[]> {
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
      { label: "Client requests logged", value: count(logged) },
      { label: "Requests won", value: count(won) },
      { label: "Requests lost or withdrawn", value: count(lost) },
      { label: "Conversion", value: pct(won, won + lost) },
    ];
  }

  private async projects(
    departmentId: string,
    period: { gte: Date; lte: Date },
  ): Promise<Figure[]> {
    const [active, completed] = await Promise.all([
      this.prisma.project.count({ where: { departmentId, status: "active" } }),
      this.prisma.project.count({ where: { departmentId, completedAt: period } }),
    ]);
    return [
      { label: "Active projects", value: count(active) },
      { label: "Projects completed", value: count(completed) },
    ];
  }
}
