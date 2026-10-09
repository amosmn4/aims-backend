import { describe, expect, it, jest } from "@jest/globals";
import { ReportContentService } from "./report-content.service";
import type { PrismaService } from "../prisma/prisma.service";

const from = new Date("2026-09-01T00:00:00Z");
const to = new Date("2026-09-30T23:59:59.999Z");
const completedOn = new Date("2026-09-20T09:00:00Z");
const editedOn = new Date("2026-10-08T09:00:00Z");
const rows = () =>
  jest.fn<(query: unknown) => Promise<Record<string, unknown>[]>>().mockResolvedValue([]);
const count = () => jest.fn<(query: unknown) => Promise<number>>().mockResolvedValue(0);

function fixture() {
  const prisma = {
    department: { findUnique: jest.fn(async () => ({ id: "hr", code: "hr" })) },
    project: {
      findUnique: jest.fn(async () => ({
        id: "project",
        name: "Client recruitment",
        health: "green",
        budget: null,
      })),
      findMany: rows(),
      count: count(),
    },
    task: { findMany: rows() },
    milestone: { findMany: rows() },
    projectDeliverable: { findMany: rows() },
    projectCostItem: { findMany: rows() },
    projectRaidEntry: { findMany: rows() },
    timelineExtension: { findMany: rows() },
    stageChange: { findMany: rows() },
    projectActivity: { findMany: rows() },
    recruitmentPlacement: { count: count() },
    recruitmentFunnel: {
      aggregate: jest.fn(async (_query: unknown) => ({ _sum: { applicationsReceived: 100 } })),
    },
    ticket: { findMany: rows(), count: count() },
    clientRequest: { findMany: rows() },
    projectTeamMember: { findMany: rows() },
  };
  return { prisma, service: new ReportContentService(prisma as unknown as PrismaService) };
}

describe("project report progress", () => {
  it("includes tasks and milestones and rounds consistently with project screens", async () => {
    const { prisma, service } = fixture();
    prisma.task.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        title: `Task ${index + 1}`,
        status: index < 8 ? "completed" : "in_progress",
        completedAt: completedOn,
      })),
    );
    prisma.milestone.findMany.mockResolvedValue([
      { title: "Handover", isComplete: false, dueDate: to },
    ]);
    const report = await service.build("project_progress", "project", from, to);
    expect(report.figures.find((figure) => figure.key === "work_done_pct")?.value).toBe(73);
  });

  it("counts incomplete deliverables in the denominator without calling them delivered", async () => {
    const { prisma, service } = fixture();
    prisma.projectDeliverable.findMany.mockResolvedValue([
      { title: "Shortlist", status: "delivered", deliveredAt: completedOn },
      { title: "Placement", status: "in_progress", deliveredAt: null },
    ]);
    const report = await service.build("project_progress", "project", from, to);
    expect(report.figures.find((figure) => figure.key === "work_done_pct")?.value).toBe(50);
    expect(report.lists.done.map((item) => item.text)).toEqual(["Delivered: Shortlist"]);
    expect(report.lists.delivered.map((item) => item.text)).toEqual(["Shortlist"]);
  });

  it("shows unknown progress when no work has been recorded", async () => {
    const { service } = fixture();
    const report = await service.build("project_progress", "project", from, to);
    expect(report.figures.find((figure) => figure.key === "work_done_pct")?.value).toBeNull();
  });
});

describe("completion attribution", () => {
  it("includes work from the whole last calendar day without including the following day", async () => {
    const { prisma, service } = fixture();
    prisma.task.findMany.mockResolvedValue([
      {
        title: "Month-end shortlist",
        status: "completed",
        completedAt: new Date("2026-09-30T09:00:00Z"),
      },
      {
        title: "Next month's work",
        status: "completed",
        completedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const periodEnd = new Date("2026-09-30T00:00:00Z");
    const report = await service.build("individual_period", "person", from, periodEnd);
    expect(report.lists.done.map((item) => item.text)).toEqual(["Month-end shortlist"]);
    expect(prisma.projectActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ occurredAt: { gte: from, lte: to } }),
      }),
    );
    expect(periodEnd.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("keeps completed work in its original period after later edits", async () => {
    const { prisma, service } = fixture();
    prisma.task.findMany.mockResolvedValue([
      {
        title: "September shortlist",
        status: "completed",
        completedAt: completedOn,
        updatedAt: editedOn,
      },
      {
        title: "October interviews",
        status: "completed",
        completedAt: editedOn,
        updatedAt: editedOn,
      },
      { title: "Historical task", status: "completed", completedAt: null, updatedAt: completedOn },
    ]);
    const project = await service.build("project_progress", "project", from, to);
    const individual = await service.build("individual_period", "person", from, to);
    expect(project.lists.done.map((item) => item.text)).toEqual(["September shortlist"]);
    expect(project.lists.done[0].when).toBe("2026-09-20");
    expect(individual.figures.find((figure) => figure.key === "tasks_finished")?.value).toBe(1);
  });

  it("uses actual milestone completion dates instead of their due dates", async () => {
    const { prisma, service } = fixture();
    prisma.milestone.findMany.mockResolvedValue([
      {
        title: "Shortlist",
        isComplete: true,
        dueDate: from,
        completedAt: completedOn,
        updatedAt: editedOn,
      },
    ]);
    const report = await service.build("project_progress", "project", from, to);
    expect(report.lists.done[0].when).toBe("2026-09-20");
  });

  it("retains historical work in whole-project completion reports", async () => {
    const { prisma, service } = fixture();
    prisma.task.findMany.mockResolvedValue([
      { title: "Historical task", status: "completed", completedAt: null },
    ]);
    const report = await service.build("project_completion", "project", from, to);
    expect(report.lists.done[0]).toMatchObject({ text: "Historical task", when: null });
  });
});

describe("HR reports", () => {
  it("includes a person's own work updates in their report without copying colleagues' updates", async () => {
    const { prisma, service } = fixture();
    prisma.projectActivity.findMany.mockResolvedValue([
      {
        summary: "Sent the shortlist to the client",
        occurredAt: completedOn,
        projectId: "project",
        project: { name: "Recruitment", client: { name: "Client A" } },
      },
    ]);
    const report = await service.build("individual_period", "person", from, to);
    expect(report.lists.updates[0].text).toContain("Sent the shortlist to the client");
    expect(prisma.projectActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdBy: "person",
          project: { scope: "department", visibility: "department" },
          parentId: null,
          occurredAt: { gte: from, lte: to },
        },
      }),
    );
  });

  it("labels lifetime recruitment applications explicitly and does not filter by last edit date", async () => {
    const { prisma, service } = fixture();
    const report = await service.build("department_monthly", "hr", from, to);
    expect(prisma.recruitmentFunnel.aggregate).toHaveBeenCalledWith({
      where: { project: { departmentId: "hr" } },
      _sum: { applicationsReceived: true },
    });
    expect(report.figures.find((figure) => figure.key === "applications_received")).toMatchObject({
      label: "Applications recorded to date",
      value: 100,
    });
  });

  it("brings dated client-project updates into the department report", async () => {
    const { prisma, service } = fixture();
    prisma.projectActivity.findMany.mockResolvedValue([
      {
        summary: "Sent a shortlist. Waiting for interview dates.",
        occurredAt: completedOn,
        projectId: "project",
        project: { name: "Recruitment", client: { name: "Client A" } },
      },
    ]);
    const report = await service.build("department_monthly", "hr", from, to);
    expect(report.lists.updates[0]).toMatchObject({
      text: "Recruitment (Client A): Sent a shortlist. Waiting for interview dates.",
      when: "2026-09-20",
      link: "/projects/project?view=discussions",
    });
    expect(prisma.projectActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project: { departmentId: "hr", visibility: "department" },
          parentId: null,
          occurredAt: { gte: from, lte: to },
        },
      }),
    );
  });

  it("keeps generated update rows within the report API text limit", async () => {
    const { prisma, service } = fixture();
    prisma.projectActivity.findMany.mockResolvedValue([
      {
        summary: "Progress ".repeat(150),
        occurredAt: completedOn,
        projectId: "project",
        project: { name: "Project ".repeat(30), client: { name: "Client ".repeat(30) } },
      },
    ]);
    const report = await service.build("department_monthly", "hr", from, to);
    expect(report.lists.updates[0].text.length).toBeLessThanOrEqual(400);
  });
});

describe("team attribution", () => {
  it("keeps company project tasks and memberships out of personal reports", async () => {
    const { service, prisma } = fixture();
    await service.build("individual_period", "person", from, to);
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assigneeId: "person", project: { scope: "department" } },
      }),
    );
    expect(prisma.projectTeamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "person", project: { scope: "department" } } }),
    );
  });
});
