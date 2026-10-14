import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { ExecutiveOverviewService } from "./executive-overview.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const ceo: AuthenticatedUser = {
  id: "ceo",
  email: "ceo@example.test",
  roles: ["ceo"],
  departmentId: null,
};

function fixture() {
  const prisma = {
    department: {
      findMany: jest.fn(async (_query: unknown) => [
        { id: "hr", code: "hr", name: "HR" },
        { id: "it", code: "it", name: "IT" },
      ]),
    },
    project: {
      count: jest.fn(async (_query: unknown) => 2),
      groupBy: jest.fn(async ({ by, where }: { by: string[]; where: { endDate?: unknown } }) =>
        by.length === 2
          ? [
              { departmentId: "hr", status: "active", _count: { _all: 1 } },
              { departmentId: null, status: "active", _count: { _all: 2 } },
              { departmentId: "hr", status: "completed", _count: { _all: 4 } },
            ]
          : [{ departmentId: "hr", _count: { _all: where.endDate ? 1 : 2 } }],
      ),
      findMany: jest.fn(async (_query: unknown) => [
        {
          id: "late",
          name: "Late project",
          health: "green",
          engagementType: "one_off",
          endDate: new Date("2026-09-30"),
          _count: { tasks: 3 },
        },
      ]),
    },
    report: {
      findMany: jest.fn(async ({ where }: { where: { kind?: string } }) =>
        where.kind
          ? [{ id: "hr-draft", departmentId: "hr", status: "draft" }]
          : [
              {
                id: "generic-review",
                title: "Monthly progress",
                submittedAt: new Date("2026-10-02"),
              },
            ],
      ),
      count: jest.fn(async (_query: unknown) => 3),
    },
    financeReport: {
      findMany: jest.fn(async (_query: unknown) => [
        { id: "finance-review", title: "Financial snapshot", submittedAt: new Date("2026-10-01") },
      ]),
      count: jest.fn(async () => 2),
    },
    projectActivity: {
      findMany: jest.fn(async (_query: unknown) => [{ summary: "a".repeat(300) }]),
    },
    task: { count: jest.fn(async (_query: unknown) => 7) },
    tender: { count: jest.fn(async (_query: unknown) => 4) },
    companySettings: { findUnique: jest.fn(async () => ({ reportDueDay: 7 })) },
  };
  return { prisma, service: new ExecutiveOverviewService(prisma as unknown as PrismaService) };
}

afterEach(() => {
  jest.useRealTimers();
});

describe("CEO overview", () => {
  it("builds chart figures from all scoped counts and counts dated completion and overdue work", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-12T09:00:00Z"));
    const { service, prisma } = fixture();
    const result = await service.overview(ceo);
    expect(result.charts.projectStatuses).toContainEqual({ status: "completed", count: 4 });
    expect(result.charts.workByTeam).toContainEqual({
      id: "company",
      name: "Company teams",
      count: 2,
    });
    expect(result.charts.reporting).toContainEqual({ status: "not_sent", count: 2 });
    expect(result.totals).toMatchObject({ completedInPeriod: 2, overdueTasks: 7 });
    expect(prisma.project.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "completed",
          completedAt: {
            gte: new Date("2026-08-31T21:00:00Z"),
            lt: new Date("2026-09-30T21:00:00Z"),
          },
        }),
      }),
    );
    expect(prisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: "completed" },
          project: expect.objectContaining({ status: { notIn: ["completed", "cancelled"] } }),
        }),
      }),
    );
  });

  it("refuses ordinary staff before reading company data", async () => {
    const { service, prisma } = fixture();
    await expect(service.overview({ ...ceo, roles: ["hr"] })).rejects.toThrow(ForbiddenException);
    expect(prisma.project.groupBy).not.toHaveBeenCalled();
  });

  it("counts company projects, covers the previous month and separates CEO reviews", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-08T09:00:00Z"));
    const { service, prisma } = fixture();
    const result = await service.overview(ceo);
    expect(result.totals).toMatchObject({
      openProjects: 3,
      waitingOnCeo: 5,
      atRisk: 2,
      closingBids: 4,
    });
    expect(result.period).toEqual({
      start: new Date("2026-09-01"),
      end: new Date("2026-09-30"),
      dueDate: new Date("2026-10-07"),
    });
    expect(result.departments[0]).toMatchObject({
      openProjects: 1,
      report: { status: "not_sent" },
    });
    expect(result.departments[1].report).toBeNull();
    expect(result.reviews.map((r) => r.id)).toEqual(["finance-review", "generic-review"]);
    expect(prisma.report.count.mock.calls[0][0]).toMatchObject({
      where: { status: "submitted", reviewerKind: "ceo" },
    });
    expect(prisma.report.findMany.mock.calls[0][0]).toMatchObject({
      where: { kind: "department", periodType: "monthly" },
    });
  });

  it("keeps overview previews bounded and excludes Water from the department scope", async () => {
    const { service, prisma } = fixture();
    const result = await service.overview(ceo);
    expect(prisma.department.findMany.mock.calls[0][0]).toMatchObject({
      where: { code: { in: ["operations", "finance", "hr", "it", "marketing", "tender"] } },
    });
    expect(prisma.project.findMany.mock.calls[0][0]).toMatchObject({ take: 8 });
    expect(prisma.projectActivity.findMany.mock.calls[0][0]).toMatchObject({ take: 8 });
    expect(prisma.financeReport.findMany.mock.calls[0][0]).toMatchObject({ take: 6 });
    expect(result.updates[0].summary).toHaveLength(240);
    expect(result.risks[0]).toMatchObject({ blockedTasks: 3, late: true });
  });

  it("uses the Nairobi calendar month before midnight UTC", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-31T22:00:00Z"));
    const result = await fixture().service.overview(ceo);
    expect(result.period.start).toEqual(new Date("2026-10-01"));
    expect(result.period.end).toEqual(new Date("2026-10-31"));
  });
});
