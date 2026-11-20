import { ConflictException } from "@nestjs/common";
import { Prisma, type OpsTask, type OpsWeeklyReport } from "@prisma/client";
import { auditActor } from "../ops-session";
import { parse, type Viewer } from "../ops.schemas";
import { taskOutcome } from "../task-content";
import { addDays, weekOf } from "./weekly-calendar";
import { weeklyItemSchema, weeklySubmissionSchema, type WeeklySubmission } from "./weekly.schemas";

export function periodPlanItems(
  tasks: OpsTask[],
  items: WeeklySubmission["items"],
  previous: WeeklySubmission["items"] = [],
) {
  const known = new Set([...items, ...previous].map((item) => item.taskId ?? item.id));
  return [
    ...items,
    ...tasks
      .filter((task) => !known.has(task.id))
      .map((task) =>
        parse(weeklyItemSchema, {
          id: task.id,
          taskId: task.id,
          title: task.title,
          detail: task.description ?? "",
          status: task.status === "To do" ? "planned" : taskOutcome(task.status),
          due: task.due,
          priority: task.priority,
          source: task.source,
          business: task.business,
          subtasks: task.subtasks ?? [],
        }),
      ),
  ];
}

type LinkedTask = {
  id: string;
  title: string;
  description?: string | null;
  assignee: string;
  weekStart?: string | null;
  due: string;
  priority: string;
  source?: string;
  business?: string;
  status: string;
  subtasks?: unknown;
};

export async function linkTaskToPlan(
  db: Prisma.TransactionClient,
  viewer: Viewer,
  task: LinkedTask,
  previous?: LinkedTask,
  now = new Date(),
  excludeId?: string,
  deleted = false,
) {
  const changedPeriod =
    previous?.weekStart !== task.weekStart || previous?.assignee !== task.assignee;
  const write = async (plan: OpsWeeklyReport, submission: WeeklySubmission, added: boolean) => {
    const content = parse(weeklySubmissionSchema, submission);
    const result = await db.opsWeeklyReport.updateMany({
      where: { id: plan.id, version: plan.version },
      data: {
        submission: content as Prisma.InputJsonObject,
        version: { increment: 1 },
        reviewedAt: null,
        reviewerId: null,
        reviewComment: null,
      },
    });
    if (!result.count)
      throw new ConflictException("The weekly plan changed. Reload before saving this task.");
    await db.auditLog.create({
      data: {
        ...auditActor(viewer),
        action: plan.submittedAt
          ? added
            ? "ops.weekly.tasks_added"
            : "ops.weekly.revised"
          : "ops.weekly.draft_saved",
        entityType: "ops-weekly",
        entityId: plan.id,
        newValue: {
          weekStart: plan.weekStart,
          phase: plan.phase,
          version: plan.version + 1,
          ...(plan.submittedAt
            ? { submission: content as Prisma.InputJsonObject, previousSubmission: plan.submission }
            : {}),
          ...(added ? { addedTaskIds: [task.id] } : {}),
        },
      },
    });
  };
  const oldReportWeek = previous ? (previous.weekStart ?? weekOf(previous.due)) : undefined;
  const reportWeek = task.weekStart ?? weekOf(task.due);
  if (previous) {
    for (const phase of ["plan", "report"] as const) {
      const previousWeek = phase === "plan" ? previous.weekStart : oldReportWeek;
      const moved =
        phase === "plan"
          ? changedPeriod
          : oldReportWeek !== reportWeek || previous.assignee !== task.assignee;
      if (!previousWeek || (!deleted && !moved)) continue;
      const old = await db.opsWeeklyReport.findUnique({
        where: {
          staffId_weekStart_phase: {
            staffId: previous.assignee,
            weekStart: previousWeek,
            phase,
          },
        },
      });
      if (
        old &&
        old.id !== excludeId &&
        ((!old.submittedAt && !old.recalledAt) ||
          now <= new Date(`${addDays(old.weekStart, 6)}T23:59:59.999+03:00`))
      ) {
        const submission = parse(weeklySubmissionSchema, old.submission);
        if (submission.items.some((item) => (item.taskId ?? item.id) === task.id))
          await write(
            old,
            {
              ...submission,
              items: submission.items.filter((item) => (item.taskId ?? item.id) !== task.id),
            },
            false,
          );
      }
    }
  }
  if (deleted) return undefined;
  let result: "waiting" | "linked" | "added" | undefined = task.weekStart ? "waiting" : undefined;
  for (const phase of ["plan", "report"] as const) {
    const weekStart = phase === "plan" ? task.weekStart : reportWeek;
    if (!weekStart) continue;
    const plan = await db.opsWeeklyReport.findUnique({
      where: {
        staffId_weekStart_phase: { staffId: task.assignee, weekStart, phase },
      },
    });
    if (!plan) continue;
    if (phase === "plan") result = "linked";
    if (plan.id === excludeId) continue;
    const submission = parse(weeklySubmissionSchema, plan.submission);
    const existing = submission.items.find((item) => (item.taskId ?? item.id) === task.id);
    const closed = now > new Date(`${addDays(plan.weekStart, 6)}T23:59:59.999+03:00`);
    if (closed && (plan.submittedAt || plan.recalledAt)) {
      if (phase === "plan" && changedPeriod && !existing)
        throw new ConflictException(
          "This plan's editing window has closed. Choose another period or save without a reporting period.",
        );
      continue;
    }
    if (!existing && submission.items.length >= 100)
      throw new ConflictException(
        "This weekly submission already has 100 tasks. Choose another period.",
      );
    const item = parse(weeklyItemSchema, {
      ...existing,
      id: existing?.id ?? task.id,
      taskId: task.id,
      title: task.title,
      detail: task.description ?? "",
      ...(phase === "report" ? { outcome: existing?.outcome ?? existing?.detail ?? "" } : {}),
      status: phase === "plan" && task.status === "To do" ? "planned" : taskOutcome(task.status),
      due: task.due,
      priority: task.priority,
      source: task.source ?? "ad_hoc",
      business: task.business ?? "b0",
      subtasks: task.subtasks ?? [],
    });
    const items = existing
      ? submission.items.map((old) => (old.id === existing.id ? item : old))
      : [...submission.items, item];
    if (JSON.stringify(items) !== JSON.stringify(submission.items))
      await write(plan, { ...submission, items }, !existing);
    if (phase === "plan" && !existing) result = "added";
  }
  return result;
}
