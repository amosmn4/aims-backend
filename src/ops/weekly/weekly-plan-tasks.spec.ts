import { describe, expect, it, jest } from "@jest/globals";
import type { OpsWeeklyReport, Prisma } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import type { Viewer } from "../ops.schemas";
import { linkTaskToPlan } from "./weekly-plan-tasks";
import { weeklySubmissionSchema } from "./weekly.schemas";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const taskId = "10000000-0000-4000-8000-000000000001";
const staffId = "10000000-0000-4000-8000-000000000002";
const partId = "10000000-0000-4000-8000-000000000003";
const now = new Date("2026-11-20T12:00:00Z");
const viewer = { id: staffId, userId: staffId, role: "staff" } as Viewer;
const task = {
  id: taskId,
  assignee: staffId,
  weekStart: "2026-11-16",
  title: "Recruitment for Client A",
  description: "<p>Campaign and selection</p>",
  status: "In progress",
  due: "2026-11-20",
  priority: "High",
  subtasks: [
    {
      id: partId,
      title: "Create shortlist",
      status: "blocked",
      done: false,
      detail: "<ul><li>Review<ul><li>Check references</li></ul></li></ul>",
    },
  ],
};

function fixture() {
  const rows = (["plan", "report"] as const).map((phase) => ({
    id: phase,
    staffId,
    weekStart: "2026-11-16",
    phase,
    version: 1,
    submittedAt: now,
    recalledAt: null,
    submission: weeklySubmissionSchema.parse({
      items: [
        {
          id: taskId,
          title: "Old title",
          detail: "",
          status: phase === "plan" ? "planned" : "pending",
          ...(phase === "report" ? { outcome: "<p>Saved outcome</p>" } : {}),
        },
      ],
    }),
  })) as unknown as OpsWeeklyReport[];
  const update = jest
    .fn<(...args: unknown[]) => Promise<{ count: number }>>()
    .mockImplementation(async (query) => {
      const value = query as {
        where: { id: string; version: number };
        data: { submission: Prisma.JsonValue };
      };
      const row = rows.find(
        (row) => row.id === value.where.id && row.version === value.where.version,
      );
      if (!row) return { count: 0 };
      row.submission = value.data.submission;
      row.version++;
      return { count: 1 };
    });
  const audit = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const db = {
    opsWeeklyReport: {
      findUnique: async (query: {
        where: { staffId_weekStart_phase: { staffId: string; weekStart: string; phase: string } };
      }) => {
        const where = query.where.staffId_weekStart_phase;
        const row = rows.find(
          (row) =>
            row.staffId === where.staffId &&
            row.weekStart === where.weekStart &&
            row.phase === where.phase,
        );
        return row ? structuredClone(row) : null;
      },
      updateMany: update,
    },
    auditLog: { create: audit },
  } as unknown as Prisma.TransactionClient;
  return { rows, update, audit, db };
}

describe("Task changes across weekly records", () => {
  it("updates active plan and report in place, retains outcomes and avoids repeated revisions", async () => {
    const { db, rows, update, audit } = fixture();
    const original = structuredClone(rows[0]!.submission);
    expect(await linkTaskToPlan(db, viewer, task, task, now)).toBe("linked");
    for (const row of rows) {
      const body = weeklySubmissionSchema.parse(row.submission);
      expect(row.version).toBe(2);
      expect(body.items[0]).toMatchObject({
        title: task.title,
        detail: task.description,
        status: "in_progress",
        subtasks: task.subtasks,
      });
      expect(body.items).toHaveLength(1);
    }
    expect(weeklySubmissionSchema.parse(rows[1]!.submission).items[0]!.outcome).toBe(
      "<p>Saved outcome</p>",
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ previousSubmission: original }),
        }),
      }),
    );
    await linkTaskToPlan(db, viewer, task, task, now);
    expect(update).toHaveBeenCalledTimes(2);
  });
  it("keeps closed submitted weeks unchanged", async () => {
    const { db, rows, update } = fixture();
    const original = structuredClone(rows);
    await linkTaskToPlan(db, viewer, task, task, new Date("2026-11-24T12:00:00Z"));
    expect(update).not.toHaveBeenCalled();
    expect(rows).toEqual(original);
  });
  it("synchronizes due-date report work without opting it into a weekly plan", async () => {
    const { db, rows } = fixture();
    const standalone = { ...task, weekStart: undefined };
    expect(await linkTaskToPlan(db, viewer, standalone, standalone, now)).toBeUndefined();
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    expect(weeklySubmissionSchema.parse(rows[1]!.submission).items[0]).toMatchObject({
      detail: task.description,
      subtasks: task.subtasks,
    });
  });
  it("retains legacy report outcomes when task instructions are synchronized", async () => {
    const { db, rows } = fixture();
    const report = rows[1]!;
    const body = weeklySubmissionSchema.parse(report.submission);
    delete body.items[0]!.outcome;
    body.items[0]!.detail = "<p>Previously submitted outcome</p>";
    report.submission = body as Prisma.JsonObject;
    await linkTaskToPlan(db, viewer, task, task, now);
    expect(weeklySubmissionSchema.parse(report.submission).items[0]).toMatchObject({
      detail: task.description,
      outcome: "<p>Previously submitted outcome</p>",
    });
  });
  it("excludes the submission being saved from a second version increment", async () => {
    const { db, rows } = fixture();
    await linkTaskToPlan(db, viewer, task, task, now, "plan");
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
  });
  it("fails a stale synchronized write without silently replacing newer content", async () => {
    const { db, update } = fixture();
    update.mockResolvedValue({ count: 0 });
    await expect(linkTaskToPlan(db, viewer, task, task, now)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it("removes moved tasks from both editable records and waits for the new plan", async () => {
    const { db, rows } = fixture();
    expect(await linkTaskToPlan(db, viewer, { ...task, weekStart: "2026-11-23" }, task, now)).toBe(
      "waiting",
    );
    expect(
      rows.every((row) => weeklySubmissionSchema.parse(row.submission).items.length === 0),
    ).toBe(true);
  });
  it("keeps checkbox edits on the same plan and report items as progress changes", async () => {
    const { db, rows } = fixture();
    const description =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Shortlist</p></div></li></ul>';
    const completed = { ...task, description, subtasks: [], status: "Done" };
    await linkTaskToPlan(db, viewer, completed, task, now);
    for (const row of rows) {
      const body = weeklySubmissionSchema.parse(row.submission);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        id: taskId,
        detail: description,
        status: "completed",
        subtasks: [],
      });
    }
    const reopened = {
      ...completed,
      description: description.replace('data-checked="true"', 'data-checked="false"'),
      status: "To do",
    };
    await linkTaskToPlan(db, viewer, reopened, completed, now);
    for (const row of rows) {
      const body = weeklySubmissionSchema.parse(row.submission);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.detail).toContain('data-checked="false"');
      expect(body.items[0]?.status).toBe(row.phase === "plan" ? "planned" : "pending");
    }
  });
});
