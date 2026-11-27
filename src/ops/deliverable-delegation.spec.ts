import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  delegatedTaskDescription,
  mergeDelegatedOutcomes,
  updateDelegatedDrafts,
  requestedDeliverableDescription,
} from "./deliverable-delegation";
import { weeklySubmissionSchema } from "./weekly/weekly.schemas";
import { checklistNodes } from "./deliverable-carryovers";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const row = (id: string, status: string, content: string) =>
  `<li data-type="taskItem" data-did="${id}" data-status="${status}" data-checked="${status === "completed"}"><div><p>${content}</p></div></li>`;
const taskId = "10000000-0000-4000-8000-000000000001";

describe("Selected deliverable synchronization", () => {
  it("updates a legacy checklist item once and preserves ambiguous legacy edits until saved", () => {
    const legacy =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>References</p></div></li></ul>';
    const draft = `<ul data-type="taskList">${row("selected", "pending", "References")}</ul>`;
    expect(checklistNodes(requestedDeliverableDescription(legacy, draft, "selected"))).toHaveLength(
      1,
    );
    expect(() =>
      requestedDeliverableDescription(
        legacy,
        draft.replace("References", "New wording"),
        "selected",
      ),
    ).toThrow("Save this edited task");
  });
  it("preserves every other draft deliverable and its notes when acceptance arrives", async () => {
    const original = `<p>Keep the draft introduction</p><ul data-type="taskList">${row("one", "pending", "References and draft notes")}${row("two", "pending", "Unrelated approval")}</ul>`;
    const source = {
      id: taskId,
      assignee: "sender",
      description: `<ul data-type="taskList">${row("one", "delegated", "References")}</ul>`,
    };
    const update = jest
      .fn<(...args: unknown[]) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const entry = {
      id: "entry",
      version: 3,
      submittedAt: null as Date | null,
      submission: weeklySubmissionSchema.parse({
        summary: "Keep objectives",
        note: "Keep notes",
        items: [{ id: taskId, title: "Work", detail: original, status: "pending" }],
      }),
    };
    const db = {
      opsWeeklyReport: {
        findUnique: async (query: { where: { staffId_weekStart_phase: { phase: string } } }) =>
          query.where.staffId_weekStart_phase.phase === "plan" ? entry : null,
        updateMany: update,
      },
    } as unknown as Prisma.TransactionClient;
    await updateDelegatedDrafts(db, source, ["2026-11-23", "2026-11-23"]);
    expect(update).toHaveBeenCalledTimes(1);
    const submission = (
      update.mock.calls[0]![0] as { data: { submission: typeof entry.submission } }
    ).data.submission;
    expect(submission).toMatchObject({ summary: "Keep objectives", note: "Keep notes" });
    expect(submission.items[0]!.detail).toContain("draft introduction");
    expect(submission.items[0]!.detail).toContain("References and draft notes");
    expect(submission.items[0]!.detail).toContain("Unrelated approval");
    expect(checklistNodes(submission.items[0]!.detail).map((node) => node.status)).toEqual([
      "delegated",
      "pending",
    ]);
    update.mockClear();
    entry.submittedAt = new Date();
    await updateDelegatedDrafts(db, source, ["2026-11-23"]);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not turn later draft additions into delegated work or duplicate previously delegated items", () => {
    const source = `<ul data-type="taskList">${row("one", "delegated", "References")}</ul>`;
    const draft = `<ul data-type="taskList">${row("one", "pending", "References")}${row("new", "pending", "Later addition")}</ul>`;
    expect(
      checklistNodes(mergeDelegatedOutcomes(draft, source)).map((node) => node.status),
    ).toEqual(["delegated", "pending"]);
    const selected = row("parent", "pending", "Prepare shortlist").replace(
      "</div>",
      `<ul data-type="taskList">${row("already", "delegated", "Already accepted elsewhere")}${row("open", "pending", "New work")}</ul></div>`,
    );
    const target = delegatedTaskDescription(selected);
    expect(target).toContain("New work");
    expect(target).not.toContain("Already accepted elsewhere");
  });
});
