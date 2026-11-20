import "reflect-metadata";
import { describe, expect, it, jest } from "@jest/globals";
import { ValidationPipe } from "@nestjs/common";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

import { SanitizeInputPipe, stripHtml } from "../common/sanitize";
import { OpsRecordBody } from "./ops-record.dto";
import { deliverablesSchema, taskOutcome, taskStatus } from "./task-content";
import { sanitizeDeliverables } from "./task-sanitization";

describe("Task content boundaries", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  it("preserves rich task fields through global pipes and sanitizes deliverable content", async () => {
    const metadata = { type: "body" as const, metatype: OpsRecordBody };
    const input = new SanitizeInputPipe().transform(
      {
        id,
        title: "<p>Recruitment</p>",
        description: "<ul><li>Campaign</li></ul>",
        subtasks: [
          {
            id,
            title: "<p>Shortlist</p>",
            done: false,
            status: "completed",
            detail: "<ul><li>Review<ul><li>References</li></ul></li></ul><script>alert(1)</script>",
          },
        ],
      },
      metadata,
    );
    const validated = await new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }).transform(input, metadata);
    expect(validated).toMatchObject({
      title: "Recruitment",
      description: "<ul><li>Campaign</li></ul>",
    });
    const parts = sanitizeDeliverables(validated.subtasks);
    expect(parts[0]).toMatchObject({
      id,
      title: "Shortlist",
      done: true,
      status: "completed",
      detail: "<ul><li>Review<ul><li>References</li></ul></li></ul>",
    });
  });
  it("keeps old checklist entries and prevents duplicate deliverable identifiers", () => {
    const part = { id, title: "Shortlist", done: true };
    expect(deliverablesSchema.parse([part])).toEqual([part]);
    expect(deliverablesSchema.safeParse([part, part]).success).toBe(false);
  });
  it("decodes legacy escaped markup and retains comparison text", () => {
    expect(stripHtml("&lt;p&gt;KeNHA Certificate&lt;/p&gt;&#x20;")).toBe("KeNHA Certificate ");
    expect(stripHtml("Budget < 50k &amp; follow-up")).toBe("Budget < 50k & follow-up");
  });
  it.each(["Done", "In progress", "Blocked", "Cancelled", "To do"])(
    "round-trips %s without losing its task status",
    (status) => {
      expect(taskStatus(taskOutcome(status))).toBe(status);
    },
  );
});
