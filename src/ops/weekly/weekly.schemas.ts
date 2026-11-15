import { z } from "zod";
import { sanitizeRichText, stripHtml } from "../../common/sanitize";

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
    detail: z.string().trim().max(2000),
    status: z.enum(["planned", "completed", "in_progress", "pending", "blocked", "cancelled"]),
  })
  .strict();
export const weeklySubmissionSchema = z
  .object({
    summary: z.string().trim().max(5000),
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
    blockers: z.string().trim().max(5000),
    nextWeek: z.string().trim().max(5000),
    noWorkReason: z.string().trim().max(2000),
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
    summary: sanitizeRichText(submission.summary),
    blockers: sanitizeRichText(submission.blockers),
    nextWeek: sanitizeRichText(submission.nextWeek),
    noWorkReason: sanitizeRichText(submission.noWorkReason),
    items: submission.items.map((item) => ({
      ...item,
      title: stripHtml(item.title),
      detail: sanitizeRichText(item.detail),
    })),
  };
}
