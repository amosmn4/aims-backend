import { z } from "zod";
import { sanitizeRichText, stripHtml } from "../../common/sanitize";
import { deliverablesSchema } from "../task-content";
import { sanitizeDeliverables } from "../task-sanitization";

export const weeklyDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date");
export const weekSchema = weeklyDate.refine(
  (value) => new Date(`${value}T12:00:00Z`).getUTCDay() === 1,
  "Select the Monday of the reporting week",
);
export const phaseSchema = z.enum(["plan", "report"]);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const day = z.number().int().min(1).max(7);
export const weeklySettingsSchema = z
  .object({
    startWeek: weekSchema,
    planDeadlineDay: day,
    planDeadlineTime: clock,
    planEmailDay: day,
    planEmailTime: clock,
    planEmailEnabled: z.boolean(),
    reportDeadlineDay: day,
    reportDeadlineTime: clock,
    reportDeadlineFollowingWeek: z.boolean(),
    reportEmailDay: day,
    reportEmailTime: clock,
    reportEmailEnabled: z.boolean(),
  })
  .strict();
export const weeklyItemSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().max(10000),
    outcome: z.string().trim().max(10000).optional(),
    status: z.enum(["planned", "completed", "in_progress", "pending", "blocked", "cancelled"]),
    due: weeklyDate.optional(),
    priority: z.enum(["Urgent", "High", "Medium", "Low"]).optional(),
    source: z.enum(["planned", "ad_hoc", "contingency", "project"]).optional(),
    business: z.string().max(36).optional(),
    subtasks: deliverablesSchema.optional(),
  })
  .strict();
export const weeklySubmissionSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    summary: z.string().trim().max(5000).default(""),
    note: z.string().trim().max(5000).optional(),
    attachments: z
      .array(z.string().uuid())
      .max(10)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    items: z
      .array(weeklyItemSchema)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Each task must have a unique identifier",
      ),
    blockers: z.string().trim().max(5000).default(""),
    nextWeek: z.string().trim().max(5000).default(""),
    noWorkReason: z.string().trim().max(2000).default(""),
    leave: z
      .array(
        z.object({ start: weeklyDate, end: weeklyDate, note: z.string().nullable().optional() }),
      )
      .optional(),
  })
  .strict();
export const weeklySaveSchema = z
  .object({
    version: z.number().int().min(0),
    submit: z.boolean(),
    submission: weeklySubmissionSchema,
  })
  .strict();
export type WeeklySettings = z.infer<typeof weeklySettingsSchema>;
export type WeeklySubmission = z.infer<typeof weeklySubmissionSchema>;
export type WeeklyPhase = z.infer<typeof phaseSchema>;

export function sanitizeWeeklySubmission(submission: WeeklySubmission): WeeklySubmission {
  return {
    ...submission,
    ...(submission.title !== undefined ? { title: stripHtml(submission.title) } : {}),
    summary: sanitizeRichText(submission.summary),
    ...(submission.note !== undefined ? { note: sanitizeRichText(submission.note) } : {}),
    blockers: sanitizeRichText(submission.blockers),
    nextWeek: sanitizeRichText(submission.nextWeek),
    noWorkReason: sanitizeRichText(submission.noWorkReason),
    items: submission.items.map((item) => ({
      ...item,
      title: stripHtml(item.title),
      detail: sanitizeRichText(item.detail),
      ...(item.outcome !== undefined ? { outcome: sanitizeRichText(item.outcome) } : {}),
      ...(item.subtasks ? { subtasks: sanitizeDeliverables(item.subtasks) } : {}),
    })),
  };
}
