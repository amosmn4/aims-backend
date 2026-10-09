import { describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { ReportsInboxService } from "./reports-inbox.service";
import { aimsFigure } from "./report-figures";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const ceo: AuthenticatedUser = {
  id: "ceo",
  email: "ceo@example.test",
  roles: ["ceo"],
  departmentId: null,
};
const author = {
  id: "staff",
  email: "staff@example.test",
  fullName: "Staff",
  roles: [{ role: "finance" }],
};

function fixture() {
  const base = {
    title: "September",
    status: "submitted",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    submittedAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-02"),
    creator: author,
  };
  const prisma = {
    department: { findUnique: jest.fn(async () => ({ id: "finance", name: "Finance" })) },
    project: {
      findMany: jest.fn(async (_query: unknown) => [{ id: "company", name: "Company rollout" }]),
    },
    report: {
      findMany: jest.fn(async (_query: unknown) => [
        {
          ...base,
          id: "individual",
          kind: "individual",
          subjectId: "staff",
          reviewerKind: "department_head",
          department: null,
          subjectUser: author,
          submissionCount: 2,
          figures: [aimsFigure("work", "Work completed", 3, "count")],
          template: "individual_period",
          sections: [],
          summary: null,
          messages: [
            {
              kind: "comment",
              body: "Additional context",
              createdAt: new Date("2026-10-02"),
              author,
            },
          ],
        },
      ]),
    },
    financeReport: {
      findMany: jest.fn(async (_query: unknown) => [
        {
          ...base,
          id: "finance-report",
          snapshot: { kpis: [{ label: "Revenue", value: 1200, format: "currency" }] },
          narrative: "Finance summary",
          _count: { comments: 1 },
          comments: [
            {
              kind: "comment",
              body: "Supporting figures",
              createdAt: new Date("2026-10-03"),
              author,
            },
          ],
        },
      ]),
    },
  };
  return { prisma, service: new ReportsInboxService(prisma as unknown as PrismaService) };
}

describe("CEO reports inbox", () => {
  it("labels team reports by their project and resolves names in one query", async () => {
    const { service, prisma } = fixture();
    const rows = await prisma.report.findMany({});
    prisma.report.findMany.mockResolvedValue(
      rows.map((row) => ({ ...row, id: "company-report", kind: "project", subjectId: "company" })),
    );
    const result = await service.inbox(ceo);
    expect(result.find((row) => row.id === "company-report")).toMatchObject({
      subjectName: "Company rollout",
      reportKind: "project",
    });
    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
  });

  it("denies department staff before loading reports", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.inbox({ ...ceo, roles: ["department_head"], departmentId: "finance" }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it("marks financial snapshots as waiting on the CEO and retains resubmission after a comment", async () => {
    const { service, prisma } = fixture();
    const rows = await service.inbox(ceo);
    expect(rows[0]).toMatchObject({
      id: "finance-report",
      decidedBy: "ceo",
      reportKind: "department",
      resubmitted: true,
      figures: [{ label: "Revenue", value: "KES 1,200" }],
    });
    expect(rows[1]).toMatchObject({
      decidedBy: "department_head",
      reportKind: "individual",
      department: null,
      resubmitted: true,
    });
    expect(prisma.report.findMany.mock.calls[0][0]).toMatchObject({
      include: { messages: { take: 1 } },
    });
    expect(prisma.financeReport.findMany.mock.calls[0][0]).toMatchObject({
      include: {
        comments: { take: 1 },
        _count: { select: { comments: { where: { kind: "resubmitted" } } } },
      },
    });
  });
});
