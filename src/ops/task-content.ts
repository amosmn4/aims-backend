import { z } from "zod";

export const deliverableSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    done: z.boolean(),
    detail: z.string().max(10000).optional(),
    status: z.enum(["pending", "in_progress", "completed", "blocked", "cancelled"]).optional(),
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
