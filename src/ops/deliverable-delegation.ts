import { ConflictException } from "@nestjs/common";
import { checklistNodes, removeNodes } from "./deliverable-carryovers";
import { sanitizeTaskDescription } from "./task-sanitization";
import type { Prisma } from "@prisma/client";
import { weeklySubmissionSchema } from "./weekly/weekly.schemas";

export function deliverableSelection(html: string, id: string) {
  const node = checklistNodes(html).find((row) => row.id === id);
  if (!node)
    throw new ConflictException(
      "This deliverable has changed. Reopen the task before delegating it.",
    );
  return { node, html: html.slice(node.start, node.end) };
}
export function requestedDeliverableDescription(previous: string, draft: string, id: string) {
  const selected = deliverableSelection(draft, id);
  const old = checklistNodes(previous);
  const position = checklistNodes(draft).findIndex((node) => node.id === id);
  const title = (html: string) =>
    (html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").replace(/<[^>]*>/g, "").trim();
  const legacy = old.filter(
    (node) => !node.id && title(previous.slice(node.start, node.end)) === title(selected.html),
  );
  const matching =
    old.find((node) => node.id === id) ??
    old.find(
      (node, index) =>
        !node.id &&
        index === position &&
        title(previous.slice(node.start, node.end)) === title(selected.html),
    ) ??
    (legacy.length === 1 ? legacy[0] : undefined);
  if (!matching && position < old.length && old.some((node) => !node.id))
    throw new ConflictException("Save this edited task before delegating its deliverable.");
  return sanitizeTaskDescription(
    matching
      ? previous.slice(0, matching.start) + selected.html + previous.slice(matching.end)
      : previous + `<ul data-type="taskList">${selected.html}</ul>`,
  );
}

export function delegatedDescription(html: string, id: string) {
  const { node, html: selected } = deliverableSelection(html, id);
  let fragment = selected;
  for (const child of checklistNodes(selected).reverse()) {
    if (["completed", "cancelled"].includes(child.status)) continue;
    const tag = `<li data-type="taskItem" data-did="${child.id}" data-status="delegated" data-checked="false">`;
    fragment = fragment.slice(0, child.start) + tag + fragment.slice(child.openEnd);
  }
  return sanitizeTaskDescription(html.slice(0, node.start) + fragment + html.slice(node.end));
}

export function delegatedTaskDescription(html: string) {
  let fragment = removeNodes(
    html,
    checklistNodes(html).filter(
      (node) => node.start > 0 && ["completed", "cancelled", "delegated"].includes(node.status),
    ),
  );
  for (const child of checklistNodes(fragment).reverse()) {
    const status = ["completed", "cancelled"].includes(child.status) ? child.status : "pending";
    const tag = `<li data-type="taskItem" data-did="${child.id}" data-status="${status}" data-checked="${status === "completed"}">`;
    fragment = fragment.slice(0, child.start) + tag + fragment.slice(child.openEnd);
  }
  return sanitizeTaskDescription(`<ul data-type="taskList">${fragment}</ul>`);
}

export function preserveDelegatedDescription(html: string, previous: string) {
  const accepted = new Set(
    checklistNodes(previous)
      .filter((node) => node.status === "delegated")
      .map((node) => node.id),
  );
  const nodes = checklistNodes(html);
  for (const node of [...nodes].reverse()) {
    if (node.status === "delegated" && !accepted.has(node.id))
      throw new ConflictException(
        "A deliverable is delegated only after the recipient accepts it.",
      );
    if (!accepted.has(node.id)) continue;
    if (!["pending", "in_progress", "blocked", "delegated"].includes(node.status))
      throw new ConflictException(
        "This deliverable has been accepted by another staff member. Update it in their plan.",
      );
    const tag = `<li data-type="taskItem" data-did="${node.id}" data-status="delegated" data-checked="false">`;
    html = html.slice(0, node.start) + tag + html.slice(node.openEnd);
  }
  return sanitizeTaskDescription(html);
}

export function mergeDelegatedOutcomes(html: string, source: string) {
  const ids = new Set(
    checklistNodes(source)
      .filter((node) => node.status === "delegated")
      .map((node) => node.id),
  );
  for (const node of checklistNodes(html).reverse()) {
    if (!ids.has(node.id)) continue;
    const tag = `<li data-type="taskItem" data-did="${node.id}" data-status="delegated" data-checked="false">`;
    html = html.slice(0, node.start) + tag + html.slice(node.openEnd);
  }
  return sanitizeTaskDescription(html);
}

export async function updateDelegatedDrafts(
  db: Prisma.TransactionClient,
  source: { id: string; assignee: string; description: string },
  weeks: string[],
) {
  for (const weekStart of new Set(weeks)) {
    for (const phase of ["plan", "report"] as const) {
      const entry = await db.opsWeeklyReport.findUnique({
        where: { staffId_weekStart_phase: { staffId: source.assignee, weekStart, phase } },
      });
      if (!entry || entry.submittedAt) continue;
      const submission = weeklySubmissionSchema.parse(entry.submission);
      let changed = false;
      for (const item of submission.items) {
        if ((item.taskId ?? item.id) !== source.id) continue;
        const detail = mergeDelegatedOutcomes(item.detail, source.description);
        if (detail === item.detail) continue;
        item.detail = detail;
        changed = true;
      }
      if (!changed) continue;
      const result = await db.opsWeeklyReport.updateMany({
        where: { id: entry.id, version: entry.version, submittedAt: null },
        data: { submission: submission as Prisma.InputJsonObject, version: { increment: 1 } },
      });
      if (!result.count)
        throw new ConflictException(
          "The sender's weekly draft changed. Reload before accepting this deliverable.",
        );
    }
  }
}
