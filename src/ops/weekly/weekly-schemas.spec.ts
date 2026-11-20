import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

import { sanitizeWeeklySubmission, weeklySubmissionSchema } from "./weekly.schemas";

describe("weekly task description and plain reporting fields", () => {
  it("formats only the task description and strips markup from other fields", () => {
    const attachmentId = "10c6a9c5-e69f-4d24-8b05-3a77f77dc521";
    const submission = weeklySubmissionSchema.parse({
      summary: "<p><strong>Progress</strong><script>alert(1)</script></p>",
      attachments: [attachmentId],
      items: [
        {
          id: "0c6a9c5e-e69f-4d24-8b05-3a77f77dc521",
          title: "<b>Prepare</b> report",
          detail: "<p><em>Review</em> work</p><img src=x onerror=alert(1)>",
          status: "planned",
        },
      ],
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
    });

    const safe = sanitizeWeeklySubmission(submission);
    expect(safe.summary).toBe("Progress");
    expect(safe.summary).not.toContain("<script>");
    expect(safe.items[0]?.title).toBe("Prepare report");
    expect(safe.items[0]?.detail).toContain("<em>Review</em>");
    expect(safe.items[0]?.detail).not.toContain("onerror");
    expect(safe.attachments).toEqual([attachmentId]);
  });

  it("limits the number of weekly attachments and rejects duplicate references", () => {
    const base = {
      summary: "",
      items: [],
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
    };
    const ids = Array.from({ length: 11 }, () => randomUUID());
    expect(weeklySubmissionSchema.safeParse({ ...base, attachments: ids }).success).toBe(false);
    expect(
      weeklySubmissionSchema.safeParse({ ...base, attachments: [ids[0], ids[0]] }).success,
    ).toBe(false);
  });
  it("uses checkbox progress for both phases while keeping manual completion without deliverables", () => {
    const detail =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Campaign</p></div></li></ul>';
    const body = weeklySubmissionSchema.parse({
      summary: "<p>Weekly objective</p>",
      note: "<strong>Notes</strong>",
      items: [
        {
          id: randomUUID(),
          title: "Recruitment",
          detail,
          status: "planned",
          outcome: "<p>Ready</p>",
        },
        { id: randomUUID(), title: "No deliverables", detail: "", status: "completed" },
      ],
    });
    const safe = sanitizeWeeklySubmission(body);
    expect(safe.items[0]).toMatchObject({ status: "completed", outcome: "Ready", subtasks: [] });
    expect(safe.items[0]?.detail).toContain('data-checked="true"');
    expect(safe.items[1]?.status).toBe("completed");
    expect(safe.note).toBe("Notes");
    expect(safe.summary).toBe("Weekly objective");
    body.items[0]!.detail = detail.replace('data-checked="true"', 'data-checked="false"');
    expect(sanitizeWeeklySubmission(body).items[0]?.status).toBe("pending");
  });
});
