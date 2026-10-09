import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { companyDateKey, startOfDay } from "../common/date-range";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const CODES = ["operations", "finance", "hr", "it", "marketing", "tender"];

@Injectable()
export class ExecutiveOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthenticatedUser) {
    if (!isAdminOrCeo(user)) throw new ForbiddenException("Only the CEO can open this overview");
    const now = new Date();
    const today = new Date(companyDateKey(now));
    const tenderToday = startOfDay(companyDateKey(now));
    const weekEnd = new Date(tenderToday.getTime() + 7 * 86_400_000);
    const periodStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const periodEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    const projectScope: Prisma.ProjectWhereInput = {
      OR: [{ scope: "company" }, { department: { code: { in: CODES } } }],
    };
    const openProjects: Prisma.ProjectWhereInput = {
      ...projectScope,
      status: { notIn: ["completed", "cancelled"] },
    };
    const lateProjects: Prisma.ProjectWhereInput = {
      ...openProjects,
      engagementType: "one_off",
      endDate: { lt: today },
    };
    const reviewWhere: Prisma.ReportWhereInput = { status: "submitted", reviewerKind: "ceo" };
    const [
      departments,
      projectCounts,
      riskCounts,
      lateCounts,
      reports,
      reviewCount,
      financeReviewCount,
      reviewReports,
      financeReviews,
      risks,
      updates,
      closingBids,
      settings,
    ] = await Promise.all([
      this.prisma.department.findMany({
        where: { code: { in: CODES } },
        select: { id: true, code: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.project.groupBy({
        by: ["departmentId", "status"],
        where: projectScope,
        _count: { _all: true },
      }),
      this.prisma.project.groupBy({
        by: ["departmentId"],
        where: { ...openProjects, health: { in: ["amber", "red"] } },
        _count: { _all: true },
      }),
      this.prisma.project.groupBy({
        by: ["departmentId"],
        where: lateProjects,
        _count: { _all: true },
      }),
      this.prisma.report.findMany({
        where: {
          kind: "department",
          periodType: "monthly",
          periodStart,
          periodEnd,
          department: { code: { in: CODES } },
        },
        select: { id: true, departmentId: true, status: true },
      }),
      this.prisma.report.count({ where: reviewWhere }),
      this.prisma.financeReport.count({ where: { status: "submitted" } }),
      this.prisma.report.findMany({
        where: reviewWhere,
        select: { id: true, title: true, submittedAt: true },
        orderBy: { submittedAt: "asc" },
        take: 6,
      }),
      this.prisma.financeReport.findMany({
        where: { status: "submitted" },
        select: { id: true, title: true, submittedAt: true },
        orderBy: { submittedAt: "asc" },
        take: 6,
      }),
      this.prisma.project.findMany({
        where: {
          ...openProjects,
          AND: [
            {
              OR: [
                { health: { in: ["amber", "red"] } },
                { engagementType: "one_off", endDate: { lt: today } },
                { tasks: { some: { status: "blocked" } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          health: true,
          endDate: true,
          engagementType: true,
          scope: true,
          department: { select: { name: true } },
          _count: { select: { tasks: { where: { status: "blocked" } } } },
        },
        orderBy: [{ health: "desc" }, { endDate: "asc" }, { id: "asc" }],
        take: 8,
      }),
      this.prisma.projectActivity.findMany({
        where: { parentId: null, project: projectScope },
        select: {
          id: true,
          projectId: true,
          summary: true,
          occurredAt: true,
          project: { select: { name: true, department: { select: { name: true } } } },
          creator: { select: { fullName: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 8,
      }),
      this.prisma.tender.count({
        where: {
          stage: { in: ["identified", "applying"] },
          submissionDeadline: { gte: tenderToday, lt: weekEnd },
        },
      }),
      this.prisma.companySettings.findUnique({
        where: { id: "company" },
        select: { reportDueDay: true },
      }),
    ]);
    const dueDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), settings?.reportDueDay ?? 5),
    );
    const openCount = projectCounts
      .filter((r) => !["completed", "cancelled"].includes(r.status))
      .reduce((sum, r) => sum + r._count._all, 0);
    return {
      generatedAt: now,
      period: { start: periodStart, end: periodEnd, dueDate },
      totals: {
        openProjects: openCount,
        atRisk: riskCounts.reduce((sum, r) => sum + r._count._all, 0),
        lateProjects: lateCounts.reduce((sum, r) => sum + r._count._all, 0),
        waitingOnCeo: reviewCount + financeReviewCount,
        closingBids,
      },
      departments: departments.map((d) => {
        const report = reports.find((r) => r.departmentId === d.id);
        return {
          ...d,
          openProjects: projectCounts
            .filter(
              (r) => r.departmentId === d.id && !["completed", "cancelled"].includes(r.status),
            )
            .reduce((sum, r) => sum + r._count._all, 0),
          atRisk: riskCounts.find((r) => r.departmentId === d.id)?._count._all ?? 0,
          lateProjects: lateCounts.find((r) => r.departmentId === d.id)?._count._all ?? 0,
          report: report
            ? { id: report.id, status: report.status === "draft" ? "not_sent" : report.status }
            : null,
        };
      }),
      reviews: [
        ...reviewReports.map((r) => ({ ...r, path: `/reports/${r.id}` })),
        ...financeReviews.map((r) => ({ ...r, path: `/finance/reports/${r.id}` })),
      ]
        .sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0))
        .slice(0, 6),
      risks: risks.map((p) => ({
        ...p,
        blockedTasks: p._count.tasks,
        late: p.engagementType === "one_off" && !!p.endDate && p.endDate < today,
        _count: undefined,
      })),
      updates: updates.map((a) => ({ ...a, summary: a.summary.slice(0, 240) })),
    };
  }
}
