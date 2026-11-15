import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";

jest.mock("../../common/sanitize", () => ({
  sanitizeRichText: (value: string) =>
    value.replace(/<script>[\s\S]*?<\/script>/gi, "").replace(/<img[^>]*>/gi, ""),
  stripHtml: (value: string) => value.replace(/<[^>]*>/g, ""),
}));

import { sanitizeWeeklySubmission, weeklySubmissionSchema } from "./weekly.schemas";

describe("weekly submission rich text", () => {
  it("preserves safe formatting and removes unsafe markup and plain-text title tags", () => {
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
    expect(safe.summary).toContain("<strong>Progress</strong>");
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
});
