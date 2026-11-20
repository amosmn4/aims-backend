import "reflect-metadata";
import { describe, expect, it, jest } from "@jest/globals";
import { ValidationPipe } from "@nestjs/common";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

import { SanitizeInputPipe, stripHtml } from "../common/sanitize";
import { OpsRecordBody } from "./ops-record.dto";
import {
  deliverablesSchema,
  taskOutcome,
  taskStatus,
  checklistProgress,
  checklistStatus,
} from "./task-content";
import { sanitizeDeliverables, sanitizeTaskDescription } from "./task-sanitization";

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
  it("preserves nested checkbox state, removes unsafe content and derives progress", () => {
    const html = sanitizeTaskDescription(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true" onclick="alert(1)"><label><input type="checkbox" checked onchange="evil()"></label><div><p>Campaign</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>References</p></div></li></ul></div></li></ul><script>evil()</script>',
    );
    expect(html).not.toMatch(/onclick|onchange|script|evil/);
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('disabled="disabled"');
    expect(checklistProgress(html)).toEqual({ total: 2, done: 1 });
    expect(checklistStatus(html, "To do")).toBe("In progress");
    expect(
      checklistStatus(html.replace('data-checked="false"', 'data-checked="true"'), "To do"),
    ).toBe("Done");
    expect(checklistStatus("", "Done")).toBe("Done");
  });
  it("folds legacy deliverables into the description without duplication", () => {
    const items = [{ id, title: "Shortlist", done: true, detail: "<p>References</p>" }];
    const html = sanitizeTaskDescription("<p>Recruitment</p>", items);
    expect(checklistProgress(html)).toEqual({ total: 1, done: 1 });
    expect(sanitizeTaskDescription(html, items)).toBe(html);
  });
});
