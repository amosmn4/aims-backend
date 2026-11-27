import { sanitizeTaskDescription } from "../task-sanitization";
import type { Prisma } from "@prisma/client";
import type { WeeklyPhase, WeeklySubmission } from "./weekly.schemas";
import { addDays } from "./weekly-calendar";
import { taskStatus, checklistStatus, checklistProgress, taskOutcome } from "../task-content";
import { syncDeliverableCarryovers } from "../deliverable-carryovers";
import type { Viewer } from "../ops.schemas";

export async function syncWeeklyTasks(
  db: Prisma.TransactionClient,
  staffId: string,
  week: string,
  phase: WeeklyPhase,
  submission: WeeklySubmission,
  skipExisting = false,
  carry?: { viewer: Viewer; now: Date; excludeId?: string },
) {
  for (const item of submission.items) {
    const id = item.taskId ?? item.id;
    const existing = await db.opsTask.findUnique({ where: { id } });
    if (existing && (skipExisting || existing.assignee !== staffId)) continue;
    const description = sanitizeTaskDescription(item.detail, item.subtasks);
    const status = checklistStatus(description, taskStatus(item.status));
    item.detail = description;
    item.subtasks = [];
    if (checklistProgress(description).total) item.status = taskOutcome(status);
    if (!existing && !item.taskId) {
      await db.opsTask.create({
        data: {
          id,
          title: item.title,
          description,
          assignee: staffId,
          weekStart: week,
          due: item.due ?? addDays(week, 6),
          priority: item.priority ?? "Medium",
          source: item.source ?? (phase === "plan" ? "planned" : "ad_hoc"),
          status,
          subtasks: [],
          business: item.business ?? "b0",
        },
      });
    } else if (existing) {
      await db.opsTask.update({
        where: { id },
        data: {
          title: item.title,
          description,
          status,
          subtasks: [],
          ...(phase === "plan" ? { weekStart: week } : {}),
          ...(item.due ? { due: item.due } : {}),
          ...(item.priority ? { priority: item.priority } : {}),
        },
      });
    }
    if (carry && (!item.taskId || existing))
      await syncDeliverableCarryovers(
        db,
        carry.viewer,
        {
          id,
          title: item.title,
          description,
          assignee: staffId,
          project: existing?.project ?? "",
          business: existing?.business ?? item.business ?? "b0",
          priority: item.priority ?? existing?.priority ?? "Medium",
          due: item.due ?? existing?.due ?? addDays(week, 6),
          weekStart: week,
          status,
        },
        existing ?? undefined,
        week,
        carry.now,
        carry.excludeId,
      );
  }
}
