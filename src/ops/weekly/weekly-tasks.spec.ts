import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import { syncWeeklyTasks } from "./weekly-tasks";

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
});
