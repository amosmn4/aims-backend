import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { sanitizeTaskDescription } from "./task-sanitization";
import { checklistStatus, type DeliverableStatus } from "./task-content";
import type { Viewer } from "./ops.schemas";
import { addDays, nairobiDate, weekOf } from "./weekly/weekly-calendar";
import { linkTaskToPlan } from "./weekly/weekly-plan-tasks";
import { weeklySubmissionSchema } from "./weekly/weekly.schemas";

type ChecklistNode = {
  start: number;
  end: number;
  openEnd: number;
  id: string;
  status: DeliverableStatus;
  date: string;
  key: string;
  parent: ChecklistNode | undefined;
};
type CarrySource = {
  id: string;
  title: string;
  description?: string | null;
  assignee: string;
  project?: string | null;
  business?: string;
  priority: string;
  due: string;
  weekStart?: string | null;
  status: string;
};

export function checklistNodes(html: string) {
  const stack: (ChecklistNode | null)[] = [];
  const nodes: ChecklistNode[] = [];
  for (const match of html.matchAll(/<\/?li\b[^>]*>/gi)) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      const node = stack.pop();
      if (node) node.end = match.index! + tag.length;
    } else {
      const attr = (name: string) => tag.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "";
      const node: ChecklistNode | null =
        attr("data-type") === "taskItem"
          ? {
              start: match.index!,
              openEnd: match.index! + tag.length,
              end: html.length,
              id: attr("data-did"),
              status: (attr("data-status") ||
                (attr("data-checked") === "true" ? "completed" : "pending")) as DeliverableStatus,
              date: attr("data-target-date"),
              key: attr("data-carry-key"),
              parent: [...stack].reverse().find((item) => !!item) ?? undefined,
            }
          : null;
      stack.push(node);
      if (node) nodes.push(node);
    }
  }
  return nodes;
}

const moving = (node: ChecklistNode) => node.status === "forwarded" || node.status === "postponed";
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const keyFor = (source: CarrySource, week: string, id: string) =>
  hash(`${source.assignee}:${source.id}:${week}:${id}`);
export function carryTaskId(source: CarrySource, week: string, target: string) {
  const value = hash(`carry:${source.assignee}:${source.id}:${week}:${target}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

function removeNodes(html: string, rows: ChecklistNode[]) {
  const outer = rows.filter(
    (row) =>
      !rows.some((other) => other !== row && other.start < row.start && other.end >= row.end),
  );
  for (const node of outer.sort((a, b) => b.start - a.start))
    html = html.slice(0, node.start) + html.slice(node.end);
  return html;
}

function carryFragment(html: string, root: ChecklistNode, source: CarrySource, week: string) {
  let fragment = html.slice(root.start, root.end);
  const children = checklistNodes(fragment);
  fragment = removeNodes(
    fragment,
    children.filter(
      (node) =>
        node.start > 0 &&
        (node.status === "completed" ||
          node.status === "cancelled" ||
          (moving(node) && weekOf(node.date) !== weekOf(root.date))),
    ),
  );
  const nodes = checklistNodes(fragment);
  for (const node of [...nodes].reverse()) {
    const tag = `<li data-type="taskItem" data-did="${node.id}" data-status="pending" data-checked="false" data-carry-key="${keyFor(source, week, node.id)}">`;
    fragment = fragment.slice(0, node.start) + tag + fragment.slice(node.openEnd);
  }
  return sanitizeTaskDescription(fragment);
}

export function validateDeliverableActions(
  description: string,
  previous: string,
  sourceWeek: string,
  now: Date,
) {
  const nodes = checklistNodes(description);
  const seen = new Set<string>();
  const old = checklistNodes(previous);
  const today = nairobiDate(now);
  const current = weekOf(today);
  for (const node of nodes) {
    if (node.id && seen.has(node.id))
      throw new BadRequestException("Each deliverable must have its own identifier.");
    if (node.id) seen.add(node.id);
    if (!moving(node)) continue;
    if (!node.id)
      throw new BadRequestException("Reopen the task editor before forwarding a deliverable.");
    const parsed = new Date(`${node.date}T12:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(node.date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== node.date
    )
      throw new BadRequestException(
        "Choose a valid destination date for each carried deliverable.",
      );
    const unchanged = old.some(
      (item) => item.id === node.id && item.status === node.status && item.date === node.date,
    );
    if (unchanged) continue;
    if (node.date <= today || node.date < sourceWeek || weekOf(node.date) > addDays(current, 364))
      throw new BadRequestException("Choose a later destination date within the next 52 weeks.");
    if (
      node.status === "forwarded" &&
      weekOf(node.date) !== addDays(sourceWeek > current ? sourceWeek : current, 7)
    )
      throw new BadRequestException("Forwarded deliverables must go to next week's plan.");
  }
  return nodes;
}

export async function syncDeliverableCarryovers(
  db: Prisma.TransactionClient,
  viewer: Viewer,
  source: CarrySource,
  previous: CarrySource | undefined,
  sourceWeek: string,
  now: Date,
  excludeId?: string,
) {
  const description = source.description ?? "";
  const nodes = validateDeliverableActions(
    description,
    previous?.description ?? "",
    sourceWeek,
    now,
  );
  const old = checklistNodes(previous?.description ?? "");
  if (!nodes.some(moving) && !old.some(moving)) return;
  if (source.assignee !== viewer.id && viewer.role !== "ceo") {
    const actions = (rows: ChecklistNode[]) =>
      JSON.stringify(
        rows
          .filter(moving)
          .map((node) => [node.id, node.status, node.date])
          .sort(),
      );
    if (actions(nodes) === actions(old)) return;
    throw new BadRequestException("Only the assignee can carry deliverables into their plan.");
  }
  const weeks = new Set([...nodes, ...old].filter(moving).map((node) => weekOf(node.date)));
  const managed = new Set(
    [...nodes, ...old]
      .filter((node) => !!node.id)
      .map((node) => keyFor(source, sourceWeek, node.id)),
  );
  for (const targetWeek of weeks) {
    const roots = nodes.filter(
      (node) =>
        moving(node) &&
        weekOf(node.date) === targetWeek &&
        !nodes.some(
          (parent) =>
            parent.start < node.start &&
            parent.end > node.end &&
            moving(parent) &&
            weekOf(parent.date) === targetWeek,
        ),
    );
    const fragments = roots.map((node) => carryFragment(description, node, source, sourceWeek));
    const desired = fragments.join("");
    const desiredNodes = checklistNodes(desired);
    const desiredKeys = new Set(desiredNodes.map((node) => node.key));
    const id = carryTaskId(source, sourceWeek, targetWeek);
    const target = await db.opsTask.findUnique({ where: { id } });
    if (
      !target &&
      roots.length &&
      roots.every((node) =>
        old.some(
          (before) =>
            before.id === node.id && before.status === node.status && before.date === node.date,
        ),
      )
    )
      continue;
    if (
      target &&
      (target.assignee !== source.assignee ||
        (target.project ?? "") !== (source.project ?? "") ||
        target.business !== (source.business ?? "b0"))
    )
      throw new ConflictException(
        "The destination task has changed. Review its plan before carrying this deliverable.",
      );
    const existingHtml = target?.description ?? "";
    const existingNodes = checklistNodes(existingHtml);
    const removals = existingNodes.filter(
      (node) => managed.has(node.key) && !desiredKeys.has(node.key),
    );
    const remainingHtml = removeNodes(existingHtml, removals);
    const remainingNodes = checklistNodes(remainingHtml);
    const additions = fragments.filter(
      (fragment) => !remainingNodes.some((node) => node.key === checklistNodes(fragment)[0]?.key),
    );
    const due = roots.length
      ? roots
          .map((node) => node.date)
          .sort()
          .at(-1)!
      : (target?.due ?? addDays(targetWeek, 4));
    const dateChanged = roots.some(
      (node) =>
        !old.some(
          (before) =>
            before.id === node.id && before.date === node.date && before.status === node.status,
        ),
    );
    const updateDue = !!target && dateChanged && due !== target.due;
    if (!removals.length && !additions.length && !updateDue) continue;
    const plan = await db.opsWeeklyReport.findUnique({
      where: {
        staffId_weekStart_phase: { staffId: source.assignee, weekStart: targetWeek, phase: "plan" },
      },
    });
    if (
      plan?.submittedAt &&
      weeklySubmissionSchema
        .parse(plan.submission)
        .items.some((item) => (item.taskId ?? item.id) === id)
    )
      throw new ConflictException(
        "This deliverable is already in a submitted destination plan. Recall that plan before changing its carryover.",
      );
    if (
      removals.some((node) =>
        existingNodes.some(
          (child) =>
            child.start >= node.start && child.end <= node.end && child.status !== "pending",
        ),
      ) ||
      (updateDue && existingNodes.some((node) => node.status !== "pending"))
    )
      throw new ConflictException(
        "A carried deliverable already has progress. Update it in its destination plan.",
      );
    let nextHtml = remainingHtml;
    if (additions.length) nextHtml += `<ul data-type="taskList">${additions.join("")}</ul>`;
    nextHtml = sanitizeTaskDescription(nextHtml);
    const active = checklistNodes(nextHtml).length > 0;
    const next = {
      id,
      title: target?.title ?? source.title,
      description: nextHtml,
      assignee: source.assignee,
      project: source.project ?? "",
      business: source.business ?? "b0",
      priority: source.priority,
      due: target && !updateDue ? target.due : due,
      weekStart: active ? targetWeek : null,
      source: "planned",
      status: active ? checklistStatus(nextHtml, "To do") : "Cancelled",
      subtasks: [],
    };
    if (nextHtml.length > 10000)
      throw new BadRequestException(
        "The carried deliverables exceed the task description limit. Forward fewer items together.",
      );
    if (target)
      await db.opsTask.update({
        where: { id },
        data: {
          description: next.description,
          status: next.status,
          weekStart: next.weekStart,
          due: next.due,
        },
      });
    else if (active)
      await db.opsTask.create({ data: { ...next, project: source.project || null } });
    else continue;
    await linkTaskToPlan(db, viewer, next, target ?? undefined, now, excludeId);
  }
}
