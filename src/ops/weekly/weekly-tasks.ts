import type { Prisma } from "@prisma/client";
import type { WeeklyPhase, WeeklySubmission } from "./weekly.schemas";
import { addDays } from "./weekly-calendar";

export async function syncWeeklyTasks(
  db: Prisma.TransactionClient,
  staffId: string,
  week: string,
  phase: WeeklyPhase,
  submission: WeeklySubmission,
  skipExisting = false,
) {
  for (const item of submission.items) {
    const id = item.taskId ?? item.id;
    const existing = await db.opsTask.findUnique({ where: { id } });
    if (existing && (skipExisting || existing.assignee !== staffId)) continue;
    const status =
      item.status === "completed"
        ? "Done"
        : item.status === "in_progress"
          ? "In progress"
          : "To do";
    if (!existing && !item.taskId) {
      await db.opsTask.create({
        data: {
          id,
          title: item.title,
          description: item.detail,
          assignee: staffId,
          weekStart: week,
          due: item.due ?? addDays(week, 6),
          priority: item.priority ?? "Medium",
          source: item.source ?? (phase === "plan" ? "planned" : "ad_hoc"),
          status,
          subtasks: item.subtasks ?? [],
          business: item.business ?? "b0",
        },
      });
    } else if (existing && phase === "report") {
      await db.opsTask.update({ where: { id }, data: { status } });
    } else if (existing && existing.source !== "project") {
      await db.opsTask.update({
        where: { id },
        data: {
          title: item.title,
          ...(item.taskId ? {} : { description: item.detail }),
          ...(item.due ? { due: item.due } : {}),
          ...(item.priority ? { priority: item.priority } : {}),
        },
      });
    }
  }
}
