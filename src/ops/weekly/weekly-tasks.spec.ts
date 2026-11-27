import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import { syncWeeklyTasks } from "./weekly-tasks";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

describe("Weekly task materialization", () => {
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
        status: "Blocked",
        subtasks: [],
      }),
    });
    expect(JSON.stringify(update.mock.calls)).not.toContain("Campaign launched");
  });
});
