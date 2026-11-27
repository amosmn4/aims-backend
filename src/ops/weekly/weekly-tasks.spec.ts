import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import { syncWeeklyTasks } from "./weekly-tasks";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

describe("Weekly task materialization", () => {
  it("closes a reported task while preserving thirteen completed deliverables and one forwarded outcome", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
    const db = {
      opsTask: { findUnique: async () => null, create },
    } as unknown as Prisma.TransactionClient;
    const rows = Array.from(
      { length: 14 },
      (_, index) =>
        `<li data-type="taskItem" data-did="row${index}" data-status="${index === 13 ? "forwarded" : "completed"}" data-checked="${index !== 13}"${index === 13 ? ' data-target-date="2026-12-04"' : ""}><div><p>Deliverable ${index + 1}</p></div></li>`,
    ).join("");
    const report = {
      summary: "Results",
      items: [
        {
          id: "task",
          title: "Recruitment",
          detail: `<ul data-type="taskList">${rows}</ul>`,
          outcome: "Accounted for",
          status: "in_progress" as const,
        },
      ],
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
    };
    await syncWeeklyTasks(db, "staff", "2026-11-23", "report", report);
    const saved = (create.mock.calls[0]![0] as { data: { status: string; description: string } })
      .data;
    expect(saved.status).toBe("Done");
    expect(saved.description.match(/data-status="completed"/g)).toHaveLength(13);
    expect(saved.description.match(/data-status="forwarded"/g)).toHaveLength(1);
    expect(report.items[0]!.status).toBe("completed");
  });
  const item = {
    id: "weekly-item",
    title: "Prepare results",
    detail: "Review the figures",
    status: "planned" as const,
  };
  const submission = {
    summary: "Plan",
    items: [item],
    blockers: "",
    nextWeek: "",
    noWorkReason: "",
  };

  it("creates a standalone task with the weekly item identifier and prevents duplicate creation", async () => {
    let stored: object | null = null;
    const create = jest
      .fn<(...args: unknown[]) => Promise<object>>()
      .mockImplementation(async (query) => {
        stored = (query as { data: object }).data;
        return stored;
      });
    const update = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
    const db = {
      opsTask: { findUnique: async () => stored, create, update },
    } as unknown as Prisma.TransactionClient;
    await syncWeeklyTasks(db, "staff", "2026-11-16", "plan", submission);
    await syncWeeklyTasks(db, "staff", "2026-11-16", "plan", submission);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "weekly-item",
        assignee: "staff",
        weekStart: "2026-11-16",
        due: "2026-11-22",
        source: "planned",
        priority: "Medium",
        status: "To do",
      }),
    });
  });

  it("preserves current task state during a historical backfill and after reassignment", async () => {
    const update = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
    const create = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
    const current = { id: item.id, assignee: "staff", status: "In progress", source: "planned" };
    const db = {
      opsTask: { findUnique: async () => current, update, create },
    } as unknown as Prisma.TransactionClient;
    await syncWeeklyTasks(
      db,
      "staff",
      "2026-11-16",
      "report",
      { ...submission, items: [{ ...item, status: "completed" }] },
      true,
    );
    await syncWeeklyTasks(db, "another-staff", "2026-11-16", "report", {
      ...submission,
      items: [{ ...item, status: "completed" }],
    });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("saves report deliverable changes and task instructions without storing outcomes as descriptions", async () => {
    const update = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
    const current = { id: item.id, assignee: "staff", source: "planned", subtasks: [] };
    const db = {
      opsTask: { findUnique: async () => current, update },
    } as unknown as Prisma.TransactionClient;
    const subtasks = [
      {
        id: "shortlist",
        title: "Shortlist",
        done: false,
        status: "blocked" as const,
        detail: "<ul><li>Check references</li></ul>",
      },
    ];
    await syncWeeklyTasks(db, "staff", "2026-11-16", "report", {
      ...submission,
      items: [
        {
          ...item,
          detail: "<p>Original instructions</p>",
          outcome: "<p>Campaign launched</p>",
          status: "blocked",
          subtasks,
        },
      ],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: item.id },
      data: expect.objectContaining({
        description: expect.stringContaining('data-type="taskList"'),
        status: "Done",
        subtasks: [],
      }),
    });
    expect(JSON.stringify(update.mock.calls)).not.toContain("Campaign launched");
  });
});
