import { describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../../prisma/prisma.service";
import type { Viewer } from "../ops.schemas";
import { reportingWorkspace } from "./reporting-workspace";
import type { WeeklyService } from "./weekly.service";
import { defaultWeeklySettings } from "./weekly-calendar";
import { weeklySubmissionSchema } from "./weekly.schemas";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

describe("Current submission listing", () => {
  it("lists one current record and retains its update count without expanding audit snapshots", async () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const staffId = "10000000-0000-4000-8000-000000000001";
    const submission = weeklySubmissionSchema.parse({ title: "Current plan", items: [] });
    const record = {
      id: "plan",
      staffId,
      weekStart: "2026-11-16",
      phase: "plan",
      submission,
      version: 3,
      submittedAt: now,
      updatedAt: now,
      reviewedAt: null,
    };
    const profiles = [
      {
        id: staffId,
        role: "staff",
        name: "Staff",
        dept: "hr",
        active: true,
        user: { isActive: true, passwordHash: "test" },
        createdAt: new Date("2026-11-01"),
      },
    ];
    const db = {
      opsStaff: { findMany: async () => profiles },
      opsWeeklyReport: { findMany: async () => [record] },
      opsReport: { findMany: async () => [] },
      opsSubmissionSchedule: { findMany: async () => [] },
      opsTask: { findMany: async () => [] },
      auditLog: {
        findMany: async () =>
          [3, 2, 1].map((version) => ({
            id: String(version),
            entityId: record.id,
            action: version === 1 ? "ops.weekly.submitted" : "ops.weekly.revised",
            createdAt: now,
            newValue: { submission: { ...submission, title: `Version ${version}` } },
          })),
      },
    } as unknown as PrismaService;
    const weekly = {
      settings: async () => ({ settings: { ...defaultWeeklySettings(), startWeek: "2026-11-16" } }),
      serialize: () => ({ ...record, counts: {} }),
    } as unknown as WeeklyService;
    const result = await reportingWorkspace(
      db,
      weekly,
      { id: staffId, role: "staff" } as Viewer,
      { view: "submissions", from: "2026-11-16", to: "2026-11-22", department: "unrelated" },
      now,
    );
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: record.id,
      title: "Current plan",
      status: "submitted",
      updates: 2,
    });
  });
});
