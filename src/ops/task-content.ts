import { z } from "zod";

export const deliverableSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    done: z.boolean(),
    detail: z.string().max(10000).optional(),
    status: z
      .enum([
        "pending",
        "in_progress",
        "completed",
        "blocked",
        "cancelled",
        "forwarded",
        "postponed",
      ])
      .optional(),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export const deliverablesSchema = z
  .array(deliverableSchema)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "Each deliverable must have a unique identifier",
  );
export function taskOutcome(
  status: string,
): "completed" | "in_progress" | "blocked" | "cancelled" | "pending" {
  return status === "Done"
    ? "completed"
    : status === "In progress"
      ? "in_progress"
      : status === "Blocked"
        ? "blocked"
        : status === "Cancelled"
          ? "cancelled"
          : "pending";
}
export function taskStatus(status: string) {
  return status === "completed"
    ? "Done"
    : status === "in_progress"
      ? "In progress"
      : status === "blocked"
        ? "Blocked"
        : status === "cancelled"
          ? "Cancelled"
          : "To do";
}

export function checklistProgress(html = "") {
  const items = html.match(/<li\b[^>]*data-type="taskItem"[^>]*>/gi) ?? [];
  return {
    total: items.length,
    done: items.filter((item) => /data-checked="true"/i.test(item)).length,
  };
}
export const deliverableStatuses = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
  "forwarded",
  "postponed",
] as const;
export type DeliverableStatus = (typeof deliverableStatuses)[number];
export function checklistOutcomes(html = "") {
  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
    forwarded: 0,
    postponed: 0,
  };
  for (const tag of html.match(/<li\b[^>]*data-type="taskItem"[^>]*>/gi) ?? []) {
    const status = tag.match(/data-status="([a-z_]+)"/i)?.[1];
    const key =
      status && Object.prototype.hasOwnProperty.call(counts, status)
        ? (status as DeliverableStatus)
        : /data-checked="true"/i.test(tag)
          ? "completed"
          : "pending";
    counts[key]++;
  }
  return counts;
}
export function checklistSummary(html = "") {
  return Object.entries(checklistOutcomes(html))
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status.replaceAll("_", " ")}`)
    .join(" | ");
}
export function checklistStatus<T extends string>(
  html: string,
  fallback: T,
): T | "To do" | "In progress" | "Done" | "Blocked" | "Cancelled" {
  const { total, done } = checklistProgress(html);
  const counts = checklistOutcomes(html);
  return !total
    ? fallback
    : counts.completed === total
      ? "Done"
      : counts.cancelled === total
        ? "Cancelled"
        : counts.blocked > 0
          ? "Blocked"
          : done || counts.forwarded || counts.postponed || counts.cancelled || counts.in_progress
            ? "In progress"
            : "To do";
}
