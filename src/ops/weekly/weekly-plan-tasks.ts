import { ConflictException } from "@nestjs/common";
import { Prisma, type OpsTask, type OpsWeeklyReport } from "@prisma/client";
import { auditActor } from "../ops-session";
import { parse, type Records, type Viewer } from "../ops.schemas";
import { addDays } from "./weekly-calendar";
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
          detail: "",
          status: "planned",
          due: task.due,
          priority: task.priority,
          source: task.source,
          business: task.business,
          subtasks: task.subtasks ?? [],
        }),
      ),
  ];
}

export async function linkTaskToPlan(
  db: Prisma.TransactionClient,
  viewer: Viewer,
  task: Records["tasks"],
  previous?: Records["tasks"],
  now = new Date(),
) {
  const changedPeriod =
    previous?.weekStart !== task.weekStart || previous?.assignee !== task.assignee;
  if (previous && !changedPeriod) return undefined;
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
          phase: "plan",
          version: plan.version + 1,
          ...(plan.submittedAt
            ? { submission: content as Prisma.InputJsonObject, previousSubmission: plan.submission }
            : {}),
          ...(added ? { addedTaskIds: [task.id] } : {}),
        },
      },
    });
  };
  if (previous?.weekStart && changedPeriod) {
    const old = await db.opsWeeklyReport.findUnique({
      where: {
        staffId_weekStart_phase: {
          staffId: previous.assignee,
          weekStart: previous.weekStart,
          phase: "plan",
        },
      },
    });
    if (
      old &&
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
  if (!task.weekStart) return undefined;
  const plan = await db.opsWeeklyReport.findUnique({
    where: {
      staffId_weekStart_phase: { staffId: task.assignee, weekStart: task.weekStart, phase: "plan" },
    },
  });
  if (!plan) return "waiting" as const;
  const submission = parse(weeklySubmissionSchema, plan.submission);
  if (submission.items.some((item) => (item.taskId ?? item.id) === task.id))
    return "linked" as const;
  if (
    (plan.submittedAt || plan.recalledAt) &&
    now > new Date(`${addDays(plan.weekStart, 6)}T23:59:59.999+03:00`)
  )
    throw new ConflictException(
      "This plan's editing window has closed. Choose another period or save without a reporting period.",
    );
  if (submission.items.length >= 100)
    throw new ConflictException("This weekly plan already has 100 tasks. Choose another period.");
  const item = parse(weeklyItemSchema, {
    id: task.id,
    taskId: task.id,
    title: task.title,
    detail: "",
    status: "planned",
    due: task.due,
    priority: task.priority,
    source: task.source ?? "ad_hoc",
    business: task.business ?? "b0",
    subtasks: task.subtasks ?? [],
  });
  await write(plan, { ...submission, items: [...submission.items, item] }, true);
  return "added" as const;
}
