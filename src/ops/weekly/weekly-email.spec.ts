import { describe, expect, it, jest } from "@jest/globals";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

import { renderWeeklyEmail } from "./weekly-email";
import { defaultWeeklySettings, phaseCounts } from "./weekly-calendar";
import { weeklySubmissionSchema, type WeeklyPhase } from "./weekly.schemas";

const staffId = "10000000-0000-4000-8000-000000000001";
const submission = weeklySubmissionSchema.parse({
  summary: "Legacy summary kept in storage",
  note: "<p>Keep payroll ready.</p>",
  items: [
    {
      id: "10000000-0000-4000-8000-000000000002",
      title: "Payroll <review> & follow-up",
      detail: "",
      status: "completed",
      priority: "Urgent",
      due: "2026-12-15",
    },
  ],
  blockers: "Waiting for approval",
  leave: [{ start: "2026-11-17", end: "2026-11-18", note: "Annual leave" }],
});

function overview(
  phase: WeeklyPhase,
  body = submission,
  submitted = true,
): Parameters<typeof renderWeeklyEmail>[0] {
  const timestamp = new Date("2026-11-20T12:00:00Z");
  const entry = {
    id: "10000000-0000-4000-8000-000000000003",
    staffId,
    weekStart: "2026-11-16",
    phase,
    version: 1,
    submission: body,
    submittedAt: submitted ? timestamp : null,
    recalledAt: null,
    reviewedAt: null,
    reviewerId: null,
    reviewComment: null,
    returnedAt: null,
    returnComment: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    editable: submitted,
    late: false,
    counts: phaseCounts(body.items),
  };
  return {
    weekStart: "2026-11-16",
    weekEnd: "2026-11-22",
    now: timestamp.toISOString(),
    configured: true,
    settings: defaultWeeklySettings(),
    deadlines: { plan: timestamp.toISOString(), report: timestamp.toISOString() },
    staff: [
      {
        id: staffId,
        name: "A & B",
        dept: null,
        active: true,
        expected: { plan: true, report: true },
        plan: phase === "plan" ? entry : null,
        report: phase === "report" ? entry : null,
      },
    ],
  };
}

describe("CEO weekly email content", () => {
  it.each(["plan", "report"] as const)(
    "keeps the %s brief focused on tasks and outcomes",
    (phase) => {
      const body = {
        ...submission,
        items: submission.items.map((item) => ({
          ...item,
          status: phase === "plan" ? ("planned" as const) : ("completed" as const),
        })),
      };
      const result = renderWeeklyEmail(overview(phase, body), phase, "https://ops.example.com");
      expect(result.html).toContain("Payroll &lt;review&gt; &amp; follow-up");
      expect(result.html).toMatch(/<th[^>]*>Task<\/th><th[^>]*>Status<\/th>/);
      expect(result.html).not.toMatch(/<th[^>]*>Notes<\/th>/);
      expect(result.html).toContain(phase === "plan" ? "Planned" : "Completed");
      expect(result.html).toContain("Keep payroll ready.");
      expect(result.html).toContain("Waiting for approval");
      expect(result.html).toContain("Annual leave");
      expect(result.html).toContain(
        `https://ops.example.com/weekly-reports?week=2026-11-16&amp;phase=${phase}&amp;staff=${staffId}`,
      );
      for (const output of [result.html, result.text]) {
        expect(output).toContain("Legacy summary");
        expect(output).toContain("Urgent");
        expect(output).toContain("2026-12-15");
        expect(output).not.toContain("No additional notes");
        expect(output).toContain("Waiting for approval");
      }
      expect(result.text).toContain("Notes: Keep payroll ready.");
      expect(result.text).toContain(phase === "plan" ? "(Planned)" : "(Completed)");
    },
  );

  it("includes meaningful task notes without filling blank cells with placeholder text", () => {
    const body = {
      ...submission,
      items: [
        { ...submission.items[0]!, detail: "<p>Reviewed <em>with finance</em>.</p>" },
        {
          ...submission.items[0]!,
          id: "10000000-0000-4000-8000-000000000004",
          title: "Follow up",
          detail: "",
        },
      ],
    };
    const result = renderWeeklyEmail(overview("report", body), "report", "https://ops.example.com");
    expect(result.html).not.toMatch(/<th[^>]*>Notes<\/th>/);
    expect(result.html).toContain("Reviewed <em>with finance</em>.");
    expect(result.text).toContain("Reviewed with finance.");
    expect(result.text).toContain("- Follow up (Completed) | Due 2026-12-15 | Priority Urgent");
    expect(result.html).not.toContain("No additional notes");
  });

  it("keeps draft contents out of both email formats", () => {
    const result = renderWeeklyEmail(
      overview("report", submission, false),
      "report",
      "https://ops.example.com",
    );
    for (const output of [result.html, result.text]) {
      expect(output).toContain("Draft, not submitted");
      expect(output).not.toContain("payroll");
      expect(output).not.toContain("Waiting for approval");
      expect(output).not.toContain("Annual leave");
      expect(output).not.toContain("Legacy summary");
    }
  });
  it("includes nested deliverable notes, statuses and outcomes in both email formats", () => {
    const body = {
      ...submission,
      items: [
        {
          ...submission.items[0]!,
          detail: "<p>Recruitment</p>",
          outcome: "<p>Campaign launched</p>",
          subtasks: [
            {
              id: "10000000-0000-4000-8000-000000000005",
              title: "Shortlist",
              done: false,
              status: "in_progress" as const,
              detail: "<ul><li>Review candidates<ul><li>Check references</li></ul></li></ul>",
            },
          ],
        },
      ],
    };
    const result = renderWeeklyEmail(overview("report", body), "report", "https://ops.example.com");
    expect(result.html).toContain(
      "<ul><li>Review candidates<ul><li>Check references</li></ul></li></ul>",
    );
    for (const output of [result.html, result.text]) {
      expect(output).toContain("Shortlist");
      expect(output).toContain("[ ]");
      expect(output).toContain("Check references");
      expect(output).toContain("Campaign launched");
    }
    expect(result.text).not.toMatch(/<\/?(?:p|ul|li)>/);
  });
});
