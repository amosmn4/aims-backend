import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import type { Viewer } from "./ops.schemas";
import {
  carryTaskId,
  checklistNodes,
  syncDeliverableCarryovers,
  validateDeliverableActions,
} from "./deliverable-carryovers";
import { sanitizeTaskDescription } from "./task-sanitization";
import { checklistStatus } from "./task-content";
import { syncWeeklyTasks } from "./weekly/weekly-tasks";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const now = new Date("2026-11-27T10:00:00Z");
const week = "2026-11-23";
const viewer = { id: "staff", userId: "user", role: "staff", name: "Staff" } as Viewer;
const row = (id: string, title: string, status = "pending", date = "", detail = "") =>
  `<li data-type="taskItem" data-did="${id}" data-status="${status}" data-checked="${status === "completed"}"${date ? ` data-target-date="${date}"` : ""}><div><p>${title}</p>${detail}</div></li>`;
const list = (...rows: string[]) => `<ul data-type="taskList">${rows.join("")}</ul>`;
const source = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Recruitment",
  assignee: "staff",
  project: "",
  business: "b0",
  priority: "High",
  due: "2026-11-27",
  weekStart: week,
  status: "In progress",
  description: "",
};

function fixture() {
  const tasks = new Map<string, typeof source>();
  let submitted = false;
  const planItems: { id: string; taskId: string; title: string; detail: string; status: string }[] =
    [];
  const create = jest
    .fn<(...args: unknown[]) => Promise<object>>()
    .mockImplementation(async (query) => {
      const data = (query as { data: typeof source }).data;
      tasks.set(data.id, structuredClone(data));
      return data;
    });
  const update = jest
    .fn<(...args: unknown[]) => Promise<object>>()
    .mockImplementation(async (query) => {
      const { where, data } = query as { where: { id: string }; data: Partial<typeof source> };
      const next = { ...tasks.get(where.id)!, ...data };
      tasks.set(where.id, next);
      return next;
    });
  const db = {
    opsTask: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        tasks.has(where.id) ? structuredClone(tasks.get(where.id)!) : null,
      create,
      update,
    },
    opsWeeklyReport: {
      findUnique: async ({
        where,
      }: {
        where: { staffId_weekStart_phase: { phase: string; weekStart: string } };
      }) =>
        where.staffId_weekStart_phase.phase === "plan"
          ? {
              id: "draft-plan",
              staffId: "staff",
              phase: "plan",
              weekStart: where.staffId_weekStart_phase.weekStart,
              version: 1,
              submittedAt: submitted ? now : null,
              submission: { items: structuredClone(planItems) },
            }
          : null,
      updateMany: async ({ data }: { data: { submission: { items: typeof planItems } } }) => {
        planItems.splice(0, planItems.length, ...data.submission.items);
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const save = (description: string, previous = "") =>
    syncDeliverableCarryovers(
      db,
      viewer,
      { ...source, description },
      { ...source, description: previous },
      week,
      now,
    );
  return {
    db,
    tasks,
    create,
    update,
    planItems,
    save,
    publish: () => {
      submitted = true;
    },
  };
}

describe("Deliverable carryovers", () => {
  it("materializes carried report deliverables once through weekly submission syncing", async () => {
    const { db, tasks, create } = fixture();
    const submission = {
      summary: "Results",
      items: [
        {
          id: source.id,
          title: source.title,
          detail: list(row("part", "References", "forwarded", "2026-12-04")),
          status: "in_progress" as const,
        },
      ],
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
    };
    await syncWeeklyTasks(db, viewer.id, week, "report", submission, false, { viewer, now });
    await syncWeeklyTasks(db, viewer.id, week, "report", submission, false, { viewer, now });
    expect(create).toHaveBeenCalledTimes(2);
    expect(tasks.size).toBe(2);
    expect(tasks.get(source.id)!.description).toContain('data-status="forwarded"');
    expect(tasks.get(carryTaskId(source, week, "2026-11-30"))!.description).toContain(
      'data-status="pending"',
    );
  });
  it("carries only selected deliverables with their notes and groups them in the destination plan", async () => {
    const { tasks, create, planItems, save } = fixture();
    const description = list(
      row("done", "Campaign", "completed"),
      row(
        "forward",
        "Shortlist",
        "forwarded",
        "2026-12-04",
        "<ul><li>Check references</li><li>Review qualifications</li></ul>",
      ),
      row("forward2", "Interview", "forwarded", "2026-12-04"),
      row("cancel", "Old opening", "cancelled"),
      row("block", "Approval", "blocked"),
    );
    await save(description);
    await save(description, description);
    expect(create).toHaveBeenCalledTimes(1);
    const task = tasks.get(carryTaskId(source, week, "2026-11-30"))!;
    expect(task).toMatchObject({
      title: "Recruitment",
      assignee: "staff",
      weekStart: "2026-11-30",
      due: "2026-12-04",
      status: "To do",
    });
    expect(task.description).toContain("Check references");
    expect(task.description).toContain("Review qualifications");
    expect(task.description).not.toMatch(/Campaign|Old opening|Approval/);
    expect(checklistNodes(task.description).map((node) => node.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(planItems).toHaveLength(1);
  });

  it("keeps nested unfinished items, excludes completed siblings and avoids a second copy of nested actions", async () => {
    const { tasks, save } = fixture();
    const description = list(
      row(
        "parent",
        "Shortlist",
        "forwarded",
        "2026-12-04",
        list(
          row("nested", "References", "forwarded", "2026-12-04"),
          row("completed", "Campaign", "completed"),
        ),
      ),
    );
    await save(description);
    const task = [...tasks.values()][0]!;
    expect(checklistNodes(task.description).map((node) => node.id)).toEqual(["parent", "nested"]);
    expect(task.description).not.toContain("Campaign");
  });

  it("postpones to a chosen future week and safely changes the destination without duplicates", async () => {
    const { tasks, save } = fixture();
    const first = list(row("part", "References", "postponed", "2027-01-13"));
    const next = list(row("part", "References", "postponed", "2027-01-20"));
    await save(first);
    await save(next, first);
    expect(tasks.get(carryTaskId(source, week, "2027-01-11"))).toMatchObject({
      status: "Cancelled",
      weekStart: null,
    });
    expect(tasks.get(carryTaskId(source, week, "2027-01-18"))).toMatchObject({
      status: "To do",
      weekStart: "2027-01-18",
      due: "2027-01-20",
    });
  });

  it("preserves progress in an existing carryover when the report is submitted again", async () => {
    const { tasks, update, save } = fixture();
    const description = list(row("part", "References", "forwarded", "2026-12-04"));
    await save(description);
    const task = [...tasks.values()][0]!;
    task.description = task.description
      .replace('data-status="pending"', 'data-status="completed"')
      .replace('data-checked="false"', 'data-checked="true"');
    task.status = "Done";
    update.mockClear();
    await save(description, description);
    expect(update).not.toHaveBeenCalled();
    expect(task.status).toBe("Done");
    await expect(save("", description)).rejects.toThrow("already has progress");
  });

  it("leaves submitted destination plans intact and accepts repeated unchanged carryovers", async () => {
    const { publish, save, tasks } = fixture();
    const description = list(row("part", "References", "forwarded", "2026-12-04"));
    await save(description);
    publish();
    await save(description, description);
    await expect(save("", description)).rejects.toThrow("submitted destination plan");
    expect(tasks.size).toBe(1);
  });

  it("validates dates, action ownership and stable identities", async () => {
    const bad = (status: string, date: string) => () =>
      validateDeliverableActions(list(row("part", "References", status, date)), "", week, now);
    expect(bad("forwarded", "2026-12-11")).toThrow("next week's plan");
    expect(bad("postponed", "2026-11-26")).toThrow("later destination date");
    expect(bad("postponed", "2027-02-30")).toThrow("valid destination date");
    expect(bad("postponed", "2028-01-01")).toThrow("52 weeks");
    expect(() =>
      validateDeliverableActions(list(row("same", "A"), row("same", "B")), "", week, now),
    ).toThrow("own identifier");
    const { save, db, tasks } = fixture();
    await expect(
      syncDeliverableCarryovers(
        db,
        { ...viewer, id: "other-staff" },
        { ...source, description: list(row("part", "References", "forwarded", "2026-12-04")) },
        source,
        week,
        now,
      ),
    ).rejects.toThrow("Only the assignee");
    expect(tasks.size).toBe(0);
    await expect(
      save(list(row("part", "References", "postponed", "2027-01-13"))),
    ).resolves.toBeUndefined();
  });

  it("preserves explicit outcomes through sanitization and derives a useful task state", () => {
    const blocked = sanitizeTaskDescription(list(row("part", "References", "blocked")));
    expect(blocked).toContain('data-status="blocked"');
    expect(checklistStatus(blocked, "To do")).toBe("Blocked");
    expect(
      checklistStatus(
        sanitizeTaskDescription(list(row("part", "References", "cancelled"))),
        "To do",
      ),
    ).toBe("Cancelled");
    expect(
      checklistStatus(
        sanitizeTaskDescription(list(row("part", "References", "forwarded", "2026-12-04"))),
        "To do",
      ),
    ).toBe("In progress");
  });
});
