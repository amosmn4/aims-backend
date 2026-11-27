import { describe, expect, it, jest } from "@jest/globals";
import { WeeklyService } from "./weekly.service";
import { defaultWeeklySettings } from "./weekly-calendar";
import type { Viewer } from "../ops.schemas";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const week = "2026-11-23";
const now = new Date("2026-11-27T18:00:00Z");
const first = new Date("2026-11-23T06:00:00Z");
const viewer = { id: "staff", role: "staff", name: "Staff", sessionId: "test" } as Viewer;
const empty = {
  summary: "Weekly work",
  note: "All work accounted for.",
  items: [],
  blockers: "",
  nextWeek: "",
  noWorkReason: "",
};

function fixture(phase: "plan" | "report", submitted = false) {
  let row: Record<string, unknown> | null = submitted
    ? {
        id: "entry",
        staffId: viewer.id,
        weekStart: week,
        phase,
        version: 1,
        submission: structuredClone(empty),
        submittedAt: first,
        firstSubmittedAt: first,
        recalledAt: null,
        returnedAt: null,
        lateReason: null,
      }
    : null;
  const audit = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const update = jest
    .fn<(...args: unknown[]) => Promise<{ count: number }>>()
    .mockImplementation(async (query) => {
      const data = (query as { data: Record<string, unknown> }).data;
      row = { ...row, ...data, version: Number(row?.version ?? 0) + 1 };
      return { count: 1 };
    });
  const db = {
    $transaction: async <T>(action: (tx: unknown) => Promise<T>) => action(db),
    opsState: { update: async () => ({}) },
    opsLeave: { findMany: async () => [] },
    opsBusiness: { findUnique: async () => ({ id: "b0" }) },
    opsTask: {
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    opsDocument: { findMany: async () => [] },
    opsSubmissionSchedule: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
    opsWeeklyReport: {
      findUnique: async (query: {
        where: { id?: string; staffId_weekStart_phase?: { phase: string } };
      }) => (query.where.id || query.where.staffId_weekStart_phase?.phase === phase ? row : null),
      updateMany: update,
      create: async (query: { data: object }) => {
        row = { id: "entry", version: 1, ...query.data };
        return row;
      },
    },
    auditLog: { create: audit, findFirst: async () => ({ createdAt: first }) },
  };
  const service = new WeeklyService(
    db as never,
    { now: () => now } as never,
    { delete: async () => {} } as never,
  );
  service.settings = async () => ({
    configured: true,
    version: 1,
    settings: { ...defaultWeeklySettings(), startWeek: week },
  });
  jest
    .spyOn(service as unknown as { actor: () => Promise<void> }, "actor")
    .mockResolvedValue(undefined);
  const save = (submit: boolean, submission: object = empty, lateReason?: string) =>
    service.save(viewer, week, phase, {
      version: Number(row?.version ?? 0),
      submit,
      submission,
      ...(lateReason ? { lateReason } : {}),
    });
  return {
    service,
    save,
    update,
    row: () => row,
    set: (value: object) => {
      row = { ...row, ...value };
    },
  };
}

describe("Weekly submission rules", () => {
  it.each(["plan", "report"] as const)(
    "requires a reason only for the initial late %s",
    async (phase) => {
      const state = fixture(phase);
      await expect(state.save(true)).rejects.toThrow("first submission");
      await expect(
        state.save(true, empty, "Client confirmation arrived late."),
      ).resolves.toMatchObject({ success: true });
      expect(state.row()).toMatchObject({
        submittedAt: now,
        firstSubmittedAt: now,
        lateReason: "Client confirmation arrived late.",
      });
      await expect(state.save(true)).resolves.toMatchObject({ success: true });
      expect(state.row()).toMatchObject({
        submittedAt: now,
        firstSubmittedAt: now,
        lateReason: "Client confirmation arrived late.",
      });
    },
  );

  it.each(["plan", "report"] as const)(
    "updates and recalls an on-time %s after the deadline without introducing lateness",
    async (phase) => {
      const state = fixture(phase, true);
      await expect(state.save(true)).resolves.toMatchObject({ success: true });
      await state.service.recall(viewer, "entry", { version: Number(state.row()!.version) });
      expect(state.row()!.submittedAt).toBeNull();
      await state.save(false);
      await expect(state.save(true)).resolves.toMatchObject({ success: true });
      expect(state.row()).toMatchObject({
        firstSubmittedAt: first,
        submittedAt: first,
        lateReason: null,
      });
    },
  );

  it("grandfathers existing task descriptions and requires deliverables for newly added tasks", async () => {
    const state = fixture("plan", true);
    const legacy = {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Existing work",
      detail: "Existing instructions",
      status: "planned",
    };
    state.set({ submittedAt: null, recalledAt: now, submission: { ...empty, items: [legacy] } });
    await expect(state.save(false, { ...empty, items: [legacy] })).resolves.toMatchObject({
      success: true,
    });
    const fresh = {
      ...legacy,
      id: "10000000-0000-4000-8000-000000000002",
      requiresDeliverables: false,
    };
    await expect(state.save(false, { ...empty, items: [legacy, fresh] })).rejects.toThrow(
      "named checklist deliverable",
    );
  });
  it("enforces named deliverables when adding tasks to an already submitted plan", async () => {
    const state = fixture("plan", true);
    await expect(
      state.service.appendTasks(viewer, "entry", {
        version: 1,
        items: [
          {
            id: "10000000-0000-4000-8000-000000000002",
            title: "New work",
            detail: "Only a paragraph",
            status: "planned",
            requiresDeliverables: false,
          },
        ],
      }),
    ).rejects.toThrow("named checklist deliverable");
  });

  it("requires a recorded outcome for every report deliverable before closing it", async () => {
    const state = fixture("report", true);
    const item = {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Current work",
      outcome: "",
      detail:
        '<ul data-type="taskList"><li data-type="taskItem" data-did="one" data-checked="false"><div><p>References</p></div></li></ul>',
      status: "pending",
    };
    await expect(state.save(true, { ...empty, items: [item] })).rejects.toThrow(
      "outcome for every deliverable",
    );
    item.detail = item.detail.replace(
      'data-checked="false"',
      'data-status="blocked" data-checked="false"',
    );
    await expect(state.save(true, { ...empty, items: [item] })).resolves.toMatchObject({
      success: true,
    });
    expect(
      (state.row()!.submission as { items: { status: string; detail: string }[] }).items[0],
    ).toMatchObject({
      status: "completed",
      detail: expect.stringContaining('data-status="blocked"'),
    });
  });
});
