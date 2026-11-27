import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OpsWeeklyReport } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../storage/storage.service";
import { stripHtml } from "../../common/sanitize";
import { assertCeo } from "../ops.policy";
import { parse, type Viewer } from "../ops.schemas";
import { auditActor, loadOpsSession } from "../ops-session";
import { WeeklyClock } from "./weekly-clock";
import { syncWeeklyTasks } from "./weekly-tasks";
import { linkTaskToPlan, periodPlanItems } from "./weekly-plan-tasks";
import { taskOutcome } from "../task-content";
import { reportingWorkspace } from "./reporting-workspace";
import {
  addDays,
  defaultWeeklySettings,
  nairobiDate,
  phaseCounts,
  scheduleFor,
  weekOf,
} from "./weekly-calendar";
import {
  phaseSchema,
  weekSchema,
  weeklySaveSchema,
  weeklyItemSchema,
  weeklySettingsSchema,
  weeklySubmissionSchema,
  sanitizeWeeklySubmission,
  type WeeklySettings,
} from "./weekly.schemas";

@Injectable()
export class WeeklyService {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: WeeklyClock,
    private readonly storage: StorageService,
  ) {}

  async settings() {
    const row = await this.db.opsWeeklySettings.findUnique({ where: { id: "workspace" } });
    return {
      configured: !!row,
      version: row?.version ?? 0,
      settings: row
        ? parse(weeklySettingsSchema, row.settings)
        : { ...defaultWeeklySettings(), startWeek: weekOf(nairobiDate(this.clock.now())) },
    };
  }

  workspace(viewer: Viewer, query: Record<string, string>) {
    return reportingWorkspace(this.db, this, viewer, query, this.clock.now());
  }

  async notifications(viewer: Viewer) {
    if (!viewer.userId) throw new ForbiddenException("A signed-in account is required.");
    return this.db.notification.findMany({
      where: { userId: viewer.userId, resourceType: { in: ["ops-weekly", "ops-delegation"] } },
      select: {
        id: true,
        title: true,
        body: true,
        isRead: true,
        resourceId: true,
        resourceType: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
  }

  async readNotification(viewer: Viewer, id: string) {
    if (!viewer.userId) throw new ForbiddenException("A signed-in account is required.");
    const result = await this.db.notification.updateMany({
      where: { id, userId: viewer.userId, resourceType: { in: ["ops-weekly", "ops-delegation"] } },
      data: { isRead: true, readAt: this.clock.now() },
    });
    if (!result.count) throw new NotFoundException("Notification not found.");
    return { success: true };
  }

  async recall(viewer: Viewer, id: string, value: unknown) {
    const dto = parse(z.object({ version: z.number().int().min(1) }).strict(), value);
    return this.db.$transaction(async (tx) => {
      await tx.opsState.update({
        where: { id: "workspace" },
        data: { revision: { increment: 1 } },
      });
      await this.actor(tx, viewer);
      const row = await tx.opsWeeklyReport.findUnique({ where: { id } });
      if (!row || row.staffId !== viewer.id) throw new NotFoundException("Submission not found.");
      const schedule = await this.settings();
      if (!row.submittedAt || !this.serialize(row, schedule.settings)?.editable)
        throw new ConflictException(
          "Only a submitted record within its editing window can be recalled.",
        );
      const pending = await tx.opsSubmissionSchedule.findUnique({
        where: {
          staffId_kind_target: { staffId: viewer.id, kind: row.phase, target: row.weekStart },
        },
      });
      if (pending?.status === "processing")
        throw new ConflictException(
          "This submission is being processed. Reload before recalling it.",
        );
      await tx.opsSubmissionSchedule.updateMany({
        where: {
          staffId: viewer.id,
          kind: row.phase,
          target: row.weekStart,
          status: { in: ["pending", "failed"] },
        },
        data: { status: "cancelled", leaseUntil: null },
      });
      const changed = await tx.opsWeeklyReport.updateMany({
        where: { id, staffId: viewer.id, version: dto.version, submittedAt: { not: null } },
        data: {
          submittedAt: null,
          recalledAt: this.clock.now(),
          reviewedAt: null,
          reviewerId: null,
          reviewComment: null,
          returnedAt: null,
          returnComment: null,
          version: { increment: 1 },
        },
      });
      if (!changed.count)
        throw new ConflictException("This submission changed. Reload before recalling it.");
      await this.audit(tx, viewer, "ops.weekly.recalled", id, {
        previousSubmission: row.submission,
        weekStart: row.weekStart,
        phase: row.phase,
        version: dto.version + 1,
      });
      return { success: true };
    });
  }

  async saveSettings(viewer: Viewer, value: unknown) {
    assertCeo(viewer);
    const dto = parse(
      z.object({ version: z.number().int().min(0), settings: weeklySettingsSchema }).strict(),
      value,
    );
    try {
      return await this.db.$transaction(async (tx) => {
        await this.actor(tx, viewer, true);
        const existing = await tx.opsWeeklySettings.findUnique({ where: { id: "workspace" } });
        if ((existing?.version ?? 0) !== dto.version)
          throw new ConflictException("The weekly schedule changed. Reload it before saving.");
        if (existing) {
          const changed = await tx.opsWeeklySettings.updateMany({
            where: { id: "workspace", version: dto.version },
            data: { settings: dto.settings, version: { increment: 1 } },
          });
          if (!changed.count)
            throw new ConflictException("The weekly schedule changed. Reload it before saving.");
        } else
          await tx.opsWeeklySettings.create({ data: { id: "workspace", settings: dto.settings } });
        await this.audit(tx, viewer, "ops.weekly.schedule_updated", "workspace", {
          settings: dto.settings,
        });
        return { success: true };
      });
    } catch (error) {
      this.conflict(error);
    }
  }

  async overview(viewer: Viewer, rawWeek?: string) {
    const week = parse(weekSchema, rawWeek ?? weekOf(nairobiDate(this.clock.now())));
    const schedule = await this.settings();
    const profiles = await this.db.opsStaff.findMany({
      where:
        viewer.role === "ceo"
          ? {
              role: "staff",
              OR: [
                { active: true, user: { isActive: true } },
                { weeklyReports: { some: { weekStart: week } } },
              ],
            }
          : { id: viewer.id },
      include: {
        user: { select: { isActive: true, passwordHash: true } },
        weeklyReports: { where: { weekStart: week } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const now = this.clock.now();
    return {
      weekStart: week,
      weekEnd: addDays(week, 6),
      now: now.toISOString(),
      configured: schedule.configured,
      settings: schedule.settings,
      deadlines: {
        plan: scheduleFor(week, "plan", schedule.settings).deadline.toISOString(),
        report: scheduleFor(week, "report", schedule.settings).deadline.toISOString(),
      },
      staff: profiles.map((person) => ({
        id: person.id,
        name: person.name,
        dept: person.dept,
        active: person.active && !!person.user?.isActive,
        expected: Object.fromEntries(
          (["plan", "report"] as const).map((phase) => [
            phase,
            week >= schedule.settings.startWeek &&
              person.role === "staff" &&
              person.active &&
              !!person.user?.isActive &&
              !!person.user.passwordHash &&
              person.createdAt <= scheduleFor(week, phase, schedule.settings).deadline,
          ]),
        ),
        plan: this.serialize(
          person.weeklyReports.find((row) => row.phase === "plan"),
          schedule.settings,
          viewer.id !== person.id,
        ),
        report: this.serialize(
          person.weeklyReports.find((row) => row.phase === "report"),
          schedule.settings,
          viewer.id !== person.id,
        ),
      })),
    };
  }

  async detail(viewer: Viewer, rawWeek: string, staffId: string) {
    if (viewer.role !== "ceo" && viewer.id !== staffId)
      throw new NotFoundException("Weekly report not found.");
    const week = parse(weekSchema, rawWeek);
    const person = await this.db.opsStaff.findUnique({
      where: { id: staffId },
      select: { id: true, name: true, dept: true },
    });
    if (!person) throw new NotFoundException("Staff member not found.");
    const schedule = await this.settings();
    const rows = await this.db.opsWeeklyReport.findMany({ where: { staffId, weekStart: week } });
    const tasks =
      viewer.id === staffId
        ? await this.db.opsTask.findMany({
            where: { assignee: staffId },
            include: { parent: { select: { name: true } } },
            orderBy: { due: "asc" },
          })
        : [];
    return {
      person,
      weekStart: week,
      weekEnd: addDays(week, 6),
      now: this.clock.now().toISOString(),
      configured: schedule.configured,
      plan: this.serialize(
        rows.find((row) => row.phase === "plan"),
        schedule.settings,
        viewer.id !== staffId,
      ),
      report: this.serialize(
        rows.find((row) => row.phase === "report"),
        schedule.settings,
        viewer.id !== staffId,
      ),
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        project: task.parent?.name ?? "Weekly work",
        status: task.status,
        due: task.due,
        weekStart: task.weekStart,
        priority: task.priority,
        source: task.source,
        business: task.business,
        subtasks: task.subtasks,
      })),
      reportOpensAt: this.reportOpens(week, schedule.settings).toISOString(),
      leave: await this.db.opsLeave.findMany({
        where: { staffId, start: { lte: addDays(week, 6) }, end: { gte: week } },
        select: { start: true, end: true, note: true },
      }),
      deadlines: {
        plan: scheduleFor(week, "plan", schedule.settings).deadline.toISOString(),
        report: scheduleFor(week, "report", schedule.settings).deadline.toISOString(),
      },
    };
  }

  async submissions(viewer: Viewer, query: Record<string, string>) {
    if (viewer.role !== "staff") throw new ForbiddenException("Staff access is required.");
    const dto = parse(
      z
        .object({
          phase: phaseSchema,
          week: weekSchema.optional(),
          status: z.enum(["submitted", "draft", "reviewed", "returned"]).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .strict(),
      query,
    );
    const where: Prisma.OpsWeeklyReportWhereInput = {
      staffId: viewer.id,
      phase: dto.phase,
      ...(dto.week ? { weekStart: dto.week } : {}),
      ...(dto.status === "submitted" ? { submittedAt: { not: null } } : {}),
      ...(dto.status === "reviewed" ? { reviewedAt: { not: null } } : {}),
      ...(dto.status === "draft" ? { submittedAt: null, returnedAt: null } : {}),
      ...(dto.status === "returned" ? { submittedAt: null, returnedAt: { not: null } } : {}),
    };
    const schedule = await this.settings();
    const [total, rows] = await this.db.$transaction([
      this.db.opsWeeklyReport.count({ where }),
      this.db.opsWeeklyReport.findMany({
        where,
        orderBy: [{ weekStart: "desc" }, { id: "desc" }],
        skip: (dto.page - 1) * 20,
        take: 20,
      }),
    ]);
    return {
      total,
      page: dto.page,
      limit: 20,
      items: rows.map((row) => this.serialize(row, schedule.settings)),
    };
  }

  async appendTasks(viewer: Viewer, id: string, value: unknown) {
    if (viewer.role !== "staff") throw new ForbiddenException("Staff access is required.");
    const dto = parse(
      z
        .object({
          version: z.number().int().min(1),
          items: z.array(weeklyItemSchema).min(1).max(100),
        })
        .strict(),
      value,
    );
    const additions = sanitizeWeeklySubmission({
      summary: "",
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
      items: dto.items,
    }).items;
    if (additions.some((item) => item.status !== "planned" || !item.title.trim()))
      throw new BadRequestException("Add planned tasks with a title.");
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.opsState.update({
          where: { id: "workspace" },
          data: { revision: { increment: 1 } },
        });
        await this.actor(tx, viewer);
        const plan = await tx.opsWeeklyReport.findUnique({ where: { id } });
        if (!plan || plan.staffId !== viewer.id || plan.phase !== "plan")
          throw new NotFoundException("Weekly plan not found.");
        if (!plan.submittedAt || plan.version !== dto.version)
          throw new ConflictException("This plan changed. Reload it before adding tasks.");
        if (this.clock.now() > new Date(`${addDays(plan.weekStart, 6)}T23:59:59.999+03:00`))
          throw new ConflictException("Tasks can only be added during the plan's reporting week.");
        const previous = parse(weeklySubmissionSchema, plan.submission);
        const submission = parse(weeklySubmissionSchema, {
          ...previous,
          items: [...previous.items, ...additions],
        });
        if (
          new Set(submission.items.map((item) => item.taskId ?? item.id)).size !==
          submission.items.length
        )
          throw new BadRequestException("Each task can appear only once in a plan.");
        for (const item of additions) {
          const business = item.business ?? "b0";
          if (
            !(await tx.opsBusiness.findUnique({ where: { id: business } })) ||
            (business !== "b0" &&
              !(await tx.opsBusinessGrant.findFirst({
                where: { personId: viewer.id, businessId: business },
              })))
          )
            throw new ForbiddenException("Choose an assigned business for weekly tasks.");
          const task = await tx.opsTask.findUnique({ where: { id: item.taskId ?? item.id } });
          if (item.taskId ? !task || task.assignee !== viewer.id : !!task)
            throw new ForbiddenException(
              "Link only your own tasks, or add a new task with a unique identifier.",
            );
        }
        const changed = await tx.opsWeeklyReport.updateMany({
          where: { id, version: dto.version, submittedAt: { not: null } },
          data: {
            submission: submission as Prisma.InputJsonObject,
            version: { increment: 1 },
            reviewedAt: null,
            reviewerId: null,
            reviewComment: null,
          },
        });
        if (!changed.count)
          throw new ConflictException("This plan changed. Reload it before adding tasks.");
        await syncWeeklyTasks(
          tx,
          viewer.id,
          plan.weekStart,
          "plan",
          { ...submission, items: additions },
          true,
        );
        await this.audit(tx, viewer, "ops.weekly.tasks_added", id, {
          previousSubmission: plan.submission,
          submission: submission as Prisma.InputJsonObject,
          addedTaskIds: additions.map((item) => item.taskId ?? item.id),
        });
        const tasks = await tx.opsTask.findMany({
          where: {
            assignee: viewer.id,
            id: { in: additions.map((item) => item.taskId ?? item.id) },
          },
        });
        for (const task of tasks)
          await linkTaskToPlan(tx, viewer, task, task, this.clock.now(), id);
        return { id, version: dto.version + 1, success: true };
      });
    } catch (error) {
      this.conflict(error);
    }
  }

  async save(viewer: Viewer, rawWeek: string, rawPhase: string, value: unknown) {
    const week = parse(weekSchema, rawWeek);
    const phase = parse(phaseSchema, rawPhase);
    const parsed = parse(weeklySaveSchema, value);
    const dto = {
      ...parsed,
      submission: parse(weeklySubmissionSchema, sanitizeWeeklySubmission(parsed.submission)),
    };
    if (
      new Set(dto.submission.items.map((item) => item.taskId ?? item.id)).size !==
      dto.submission.items.length
    )
      throw new BadRequestException("Include each task only once in a submission.");
    const schedule = await this.settings();
    if (!schedule.configured)
      throw new BadRequestException("The CEO must configure weekly reporting first.");
    const now = this.clock.now();
    const current = weekOf(nairobiDate(this.clock.now()));
    if (week < schedule.settings.startWeek || week > addDays(current, phase === "plan" ? 364 : 7))
      throw new BadRequestException(
        phase === "plan"
          ? "Choose an enabled plan week within the next 52 weeks."
          : "Choose an enabled reporting week, up to one week ahead.",
      );
    if (phase === "report" && dto.submission.items.some((item) => item.status === "planned"))
      throw new BadRequestException("Set the outcome of every task.");
    const lateReason = dto.lateReason ? stripHtml(dto.lateReason).trim() : undefined;
    if (dto.submit) {
      if (phase === "report" && now < this.reportOpens(week, schedule.settings))
        throw new BadRequestException(
          "It is too early to submit this week's results. Save a draft until the reporting window opens.",
        );
      if (
        now > scheduleFor(week, phase, schedule.settings).deadline &&
        viewer.sessionId !== "scheduler" &&
        !lateReason
      )
        throw new BadRequestException("A reason is required when submitting after the deadline.");
      if (
        now > scheduleFor(week, phase, schedule.settings).deadline &&
        viewer.sessionId !== "scheduler" &&
        (lateReason?.length ?? 0) < 5
      )
        throw new BadRequestException("Enter a reason of at least five characters.");
    }
    const storageKeys: string[] = [];
    try {
      const result = await this.db.$transaction(async (tx) => {
        await tx.opsState.update({
          where: { id: "workspace" },
          data: { revision: { increment: 1 } },
        });
        await this.actor(tx, viewer);
        dto.submission.leave = (
          await tx.opsLeave.findMany({
            where: { staffId: viewer.id, start: { lte: addDays(week, 6) }, end: { gte: week } },
            select: { start: true, end: true, note: true },
          })
        ).map((row) => ({
          ...row,
          start: row.start < week ? week : row.start,
          end: row.end > addDays(week, 6) ? addDays(week, 6) : row.end,
        }));
        const existing = await tx.opsWeeklyReport.findUnique({
          where: { staffId_weekStart_phase: { staffId: viewer.id, weekStart: week, phase } },
        });
        if (phase === "plan") {
          const tasks = await tx.opsTask.findMany({
            where: { assignee: viewer.id, weekStart: week },
            orderBy: [{ due: "asc" }, { id: "asc" }],
          });
          const previous = existing ? parse(weeklySubmissionSchema, existing.submission).items : [];
          dto.submission = parse(weeklySubmissionSchema, {
            ...dto.submission,
            items: periodPlanItems(tasks, dto.submission.items, previous),
          });
        }
        const businessIds = [...new Set(dto.submission.items.map((item) => item.business ?? "b0"))];
        for (const business of businessIds) {
          if (
            !(await tx.opsBusiness.findUnique({ where: { id: business } })) ||
            (viewer.role !== "ceo" &&
              business !== "b0" &&
              !(await tx.opsBusinessGrant.findFirst({
                where: { personId: viewer.id, businessId: business },
              })))
          )
            throw new ForbiddenException("Choose an assigned business for weekly tasks.");
        }
        const attachmentIds = dto.submission.attachments ?? [];
        if (attachmentIds.length) {
          const documents = await tx.opsDocument.findMany({
            where: { id: { in: attachmentIds } },
            select: { id: true, owner: true, access: true, weeklyRef: true },
          });
          const expectedRef = `weekly:${viewer.id}:${week}:${phase}`;
          if (
            documents.length !== attachmentIds.length ||
            documents.some(
              (document) =>
                document.owner !== viewer.id ||
                document.access !== "restricted" ||
                document.weeklyRef !== expectedRef,
            )
          )
            throw new ForbiddenException(
              "Weekly attachments must be uploaded by you for this reporting period.",
            );
        }
        if ((existing?.version ?? 0) !== dto.version)
          throw new ConflictException(
            "This submission changed. Reload it before saving; keep a copy of your draft.",
          );
        if (existing?.submittedAt || existing?.recalledAt) {
          const end = new Date(`${addDays(week, 6)}T23:59:59.999+03:00`);
          const deadline = scheduleFor(week, phase, schedule.settings).deadline;
          const editableUntil = phase === "report" && deadline > end ? deadline : end;
          if ((existing.submittedAt && !dto.submit) || this.clock.now() > editableUntil)
            throw new ConflictException(
              "This submitted record can only be updated during its reporting period.",
            );
        }
        const expectedRef = `weekly:${viewer.id}:${week}:${phase}`;
        const staleAttachments = await tx.opsDocument.findMany({
          where: { owner: viewer.id, weeklyRef: expectedRef },
          select: { id: true, storageKey: true },
        });
        const attached = new Set(attachmentIds);
        const stale = staleAttachments.filter((document) => !attached.has(document.id));
        if (stale.length) {
          await tx.opsDocument.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
          await tx.opsState.update({
            where: { id: "workspace" },
            data: { revision: { increment: 1 } },
          });
          await this.audit(tx, viewer, "ops.weekly.attachments_removed", expectedRef, {
            documentIds: stale.map((row) => row.id),
          });
          storageKeys.push(...stale.map((document) => document.storageKey));
        }
        const plan =
          phase === "report"
            ? await tx.opsWeeklyReport.findUnique({
                where: {
                  staffId_weekStart_phase: { staffId: viewer.id, weekStart: week, phase: "plan" },
                },
              })
            : null;
        const trusted = [existing, plan].flatMap((row) =>
          row ? parse(weeklySubmissionSchema, row.submission).items : [],
        );
        const linked = dto.submission.items.flatMap((item) => (item.taskId ? [item.taskId] : []));
        if (linked.length) {
          const owned = await tx.opsTask.findMany({
            where: { id: { in: [...new Set(linked)] }, assignee: viewer.id },
            select: { id: true },
          });
          if (
            dto.submission.items.some(
              (item) =>
                item.taskId &&
                !owned.some((task) => task.id === item.taskId) &&
                !trusted.some((old) => old.id === item.id && old.taskId === item.taskId),
            )
          )
            throw new ForbiddenException(
              "Only your own current tasks can be linked to a weekly submission.",
            );
        }
        if (phase === "report" && dto.submit) {
          const weeklyTasks = await tx.opsTask.findMany({
            where: {
              assignee: viewer.id,
              OR: [
                { weekStart: week },
                { weekStart: null, due: { gte: week, lte: addDays(week, 6) } },
              ],
            },
          });
          const planned = plan?.submittedAt
            ? parse(weeklySubmissionSchema, plan.submission).items
            : [];
          const required = [
            ...planned.map((item) => {
              const task = weeklyTasks.find((row) => row.id === (item.taskId ?? item.id));
              return {
                ...item,
                outcome: "",
                status: task
                  ? taskOutcome(task.status)
                  : item.status === "planned"
                    ? ("pending" as const)
                    : item.status,
              };
            }),
            ...weeklyTasks.map((task) => ({
              id: task.id,
              taskId: task.id,
              title: task.title,
              detail: task.description ?? "",
              outcome: "",
              subtasks: parse(weeklyItemSchema.shape.subtasks, task.subtasks ?? []),
              business: task.business,
              status: taskOutcome(task.status),
            })),
          ];
          for (const item of required) {
            if (
              !dto.submission.items.some(
                (row) => (row.taskId ?? row.id) === (item.taskId ?? item.id),
              )
            )
              dto.submission.items.push(item);
          }
          if (dto.submission.items.length > 100)
            throw new BadRequestException("A weekly report can include up to 100 tasks.");
          const current = await tx.opsTask.findMany({
            where: {
              assignee: viewer.id,
              id: { in: dto.submission.items.map((item) => item.taskId ?? item.id) },
            },
          });
          dto.submission.items = dto.submission.items.map((item) => {
            const task = current.find((row) => row.id === (item.taskId ?? item.id));
            const plannedItem = planned.find(
              (row) => (row.taskId ?? row.id) === (item.taskId ?? item.id),
            );
            const content =
              item.outcome === undefined
                ? {
                    ...item,
                    outcome: item.detail,
                    detail: task?.description ?? plannedItem?.detail ?? "",
                  }
                : item;
            return task
              ? {
                  ...content,
                  priority:
                    item.priority ?? (task.priority as "Urgent" | "High" | "Medium" | "Low"),
                }
              : content;
          });
        }
        if (
          dto.submit &&
          !dto.submission.items.length &&
          ![dto.submission.note, dto.submission.noWorkReason].some(
            (value) => value && stripHtml(value).trim().length >= 5,
          ) &&
          !dto.submission.leave?.length
        )
          throw new BadRequestException("Add a task or a note explaining this week.");
        const data = {
          submission: dto.submission as Prisma.InputJsonObject,
          submittedAt: dto.submit ? (existing?.submittedAt ?? now) : null,
          lateReason: dto.submit
            ? now > scheduleFor(week, phase, schedule.settings).deadline
              ? (lateReason ?? existing?.lateReason ?? null)
              : null
            : (existing?.lateReason ?? null),
          recalledAt: dto.submit ? null : (existing?.recalledAt ?? null),
          reviewedAt: null,
          reviewerId: null,
          reviewComment: null,
          returnedAt: null,
          returnComment: null,
        };
        if (phase === "plan" && existing) {
          const removed = parse(weeklySubmissionSchema, existing.submission).items.filter(
            (item) =>
              !dto.submission.items.some(
                (next) => (next.taskId ?? next.id) === (item.taskId ?? item.id),
              ),
          );
          await tx.opsTask.updateMany({
            where: {
              id: { in: removed.map((item) => item.taskId ?? item.id) },
              assignee: viewer.id,
              weekStart: week,
            },
            data: { weekStart: null },
          });
        }
        if (dto.submit) {
          const previousLinkedTasks =
            phase === "plan"
              ? await tx.opsTask.findMany({
                  where: {
                    id: {
                      in: dto.submission.items.flatMap((item) =>
                        item.taskId ? [item.taskId] : [],
                      ),
                    },
                    assignee: viewer.id,
                  },
                })
              : [];
          await syncWeeklyTasks(tx, viewer.id, week, phase, dto.submission, false, {
            viewer,
            now,
            ...(existing ? { excludeId: existing.id } : {}),
          });
          for (const previous of previousLinkedTasks) {
            if (previous.weekStart === week) continue;
            const next = await tx.opsTask.findUnique({ where: { id: previous.id } });
            if (next)
              await linkTaskToPlan(tx, viewer, next, previous, this.clock.now(), existing?.id);
          }
        }
        let id: string;
        if (existing) {
          const changed = await tx.opsWeeklyReport.updateMany({
            where: { id: existing.id, version: dto.version },
            data: { ...data, version: { increment: 1 } },
          });
          if (!changed.count)
            throw new ConflictException("This submission changed. Reload it before saving.");
          id = existing.id;
        } else
          id = (
            await tx.opsWeeklyReport.create({
              data: { staffId: viewer.id, weekStart: week, phase, ...data },
            })
          ).id;
        await this.audit(
          tx,
          viewer,
          existing?.submittedAt
            ? "ops.weekly.revised"
            : dto.submit
              ? "ops.weekly.submitted"
              : "ops.weekly.draft_saved",
          id,
          {
            weekStart: week,
            phase,
            version: dto.version + 1,
            ...(dto.submit ? { submission: dto.submission } : {}),
            ...(dto.submit && data.lateReason ? { lateReason: data.lateReason } : {}),
            ...(existing?.submittedAt ? { previousSubmission: existing.submission } : {}),
          },
        );
        if (dto.submit) {
          const tasks = await tx.opsTask.findMany({
            where: {
              assignee: viewer.id,
              id: { in: dto.submission.items.map((item) => item.taskId ?? item.id) },
            },
          });
          for (const task of tasks)
            await linkTaskToPlan(tx, viewer, task, task, this.clock.now(), id);
        }
        return { id, version: dto.version + 1, success: true };
      });
      await Promise.all(storageKeys.map((key) => this.storage.delete(key)));
      return result;
    } catch (error) {
      this.conflict(error);
    }
  }

  async deleteDraft(viewer: Viewer, id: string, value: unknown) {
    const dto = parse(z.object({ version: z.number().int().min(1) }).strict(), value);
    const storageKeys: string[] = [];
    await this.db.$transaction(async (tx) => {
      await tx.opsState.update({
        where: { id: "workspace" },
        data: { revision: { increment: 1 } },
      });
      await this.actor(tx, viewer);
      const row = await tx.opsWeeklyReport.findUnique({ where: { id } });
      if (!row || row.staffId !== viewer.id) throw new NotFoundException("Draft not found.");
      if (row.version !== dto.version || row.submittedAt || row.reviewedAt || row.returnedAt)
        throw new ConflictException("Only an unchanged, unsubmitted draft can be deleted.");
      const previous = await tx.auditLog.findFirst({
        where: { entityType: "ops-weekly", entityId: id, action: "ops.weekly.submitted" },
      });
      if (previous) throw new ConflictException("A previously submitted record cannot be deleted.");
      const scheduled = await tx.opsSubmissionSchedule.findUnique({
        where: {
          staffId_kind_target: { staffId: viewer.id, kind: row.phase, target: row.weekStart },
        },
      });
      if (scheduled?.status === "processing")
        throw new ConflictException("This draft is being submitted. Reload before making changes.");
      const cancelled = await tx.opsSubmissionSchedule.updateMany({
        where: {
          staffId: viewer.id,
          kind: row.phase,
          target: row.weekStart,
          status: { in: ["pending", "failed"] },
        },
        data: { status: "cancelled", leaseUntil: null },
      });
      if (scheduled && ["pending", "failed"].includes(scheduled.status) && !cancelled.count)
        throw new ConflictException("The schedule changed. Reload before deleting this draft.");
      const documents = await tx.opsDocument.findMany({
        where: { owner: viewer.id, weeklyRef: `weekly:${viewer.id}:${row.weekStart}:${row.phase}` },
        select: { id: true, storageKey: true },
      });
      await tx.opsDocument.deleteMany({
        where: { id: { in: documents.map((document) => document.id) } },
      });
      await tx.opsWeeklyReport.delete({ where: { id } });
      storageKeys.push(...documents.map((document) => document.storageKey));
      await this.audit(tx, viewer, "ops.weekly.draft_deleted", id, {
        weekStart: row.weekStart,
        phase: row.phase,
      });
    });
    await Promise.all(storageKeys.map((key) => this.storage.delete(key)));
    return { success: true };
  }

  async review(viewer: Viewer, id: string, value: unknown, returning = false) {
    assertCeo(viewer);
    const dto = parse(
      z.object({ version: z.number().int().min(1), comment: z.string().trim().max(5000) }).strict(),
      value,
    );
    if (returning && dto.comment.length < 5)
      throw new BadRequestException("Explain the correction needed in at least five characters.");
    return this.db.$transaction(async (tx) => {
      await this.actor(tx, viewer, true);
      const old = await tx.opsWeeklyReport.findUnique({ where: { id } });
      if (!old?.submittedAt)
        throw new ConflictException("Only submitted records can be reviewed or returned.");
      if (old.reviewedAt && !returning)
        throw new ConflictException("This submission has already been reviewed.");
      const changed = await tx.opsWeeklyReport.updateMany({
        where: { id, version: dto.version, submittedAt: { not: null } },
        data: returning
          ? {
              submittedAt: null,
              reviewedAt: null,
              reviewerId: null,
              reviewComment: null,
              returnedAt: this.clock.now(),
              returnComment: dto.comment,
              version: { increment: 1 },
            }
          : {
              reviewedAt: this.clock.now(),
              reviewerId: viewer.id,
              reviewComment: dto.comment,
              version: { increment: 1 },
            },
      });
      if (!changed.count)
        throw new ConflictException("This submission changed. Reload it before reviewing.");
      await this.audit(tx, viewer, returning ? "ops.weekly.returned" : "ops.weekly.reviewed", id, {
        comment: dto.comment,
        ...(returning ? { previousSubmission: old.submission } : {}),
      });
      const recipient = await tx.opsStaff.findUnique({
        where: { id: old.staffId },
        select: { userId: true },
      });
      if (recipient?.userId)
        await tx.notification.create({
          data: {
            userId: recipient.userId,
            type: "report_reviewed",
            severity: returning ? "warning" : "info",
            title: returning
              ? `Weekly ${old.phase} needs attention`
              : `Weekly ${old.phase} reviewed`,
            body: dto.comment || "The CEO has reviewed your submission.",
            resourceType: "ops-weekly",
            resourceId: id,
            dedupeKey: `ops-weekly-review:${id}:${dto.version + 1}`,
            createdBy: viewer.userId,
          },
        });
      return { success: true };
    });
  }

  async history(viewer: Viewer, id: string) {
    if (viewer.role !== "staff") throw new NotFoundException("Weekly report not found.");
    const report = await this.db.opsWeeklyReport.findUnique({ where: { id } });
    if (!report || report.staffId !== viewer.id)
      throw new NotFoundException("Weekly report not found.");
    return this.db.auditLog.findMany({
      where: { entityType: "ops-weekly", entityId: id },
      select: { id: true, action: true, newValue: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  serialize(row: OpsWeeklyReport | undefined, settings: WeeklySettings, privateDraft = false) {
    if (!row) return null;
    if (privateDraft && !row.submittedAt) return null;
    const submission =
      privateDraft && !row.submittedAt
        ? { summary: "", items: [], blockers: "", nextWeek: "", noWorkReason: "" }
        : parse(weeklySubmissionSchema, row.submission);
    const end = new Date(`${addDays(row.weekStart, 6)}T23:59:59.999+03:00`);
    const deadline = scheduleFor(row.weekStart, parse(phaseSchema, row.phase), settings).deadline;
    return {
      ...row,
      editable:
        !!row.submittedAt &&
        this.clock.now() <= (row.phase === "report" && deadline > end ? deadline : end),
      submission,
      counts: phaseCounts(submission.items),
      late:
        !!row.submittedAt &&
        row.submittedAt > scheduleFor(row.weekStart, row.phase, settings).deadline,
    };
  }
  private reportOpens(week: string, settings: WeeklySettings) {
    const day = Math.min(
      4,
      settings.reportDeadlineDay - 1 + (settings.reportDeadlineFollowingWeek ? 7 : 0),
    );
    return new Date(`${addDays(week, day)}T00:00:00+03:00`);
  }
  private async actor(tx: Prisma.TransactionClient, viewer: Viewer, ceo = false) {
    if (viewer.sessionId !== "scheduler") {
      const { viewer: current } = await loadOpsSession(
        tx,
        viewer.sessionId,
        undefined,
        viewer.sessionVersion ?? 0,
      );
      if (
        current.id !== viewer.id ||
        current.userId !== viewer.userId ||
        current.role !== viewer.role ||
        current.dept !== viewer.dept
      )
        throw new ForbiddenException("Your Ops access changed. Sign in again.");
    }
    const person = await tx.opsStaff.findUnique({
      where: { id: viewer.id },
      include: { user: { select: { isActive: true } } },
    });
    if (
      !person?.active ||
      person.role === "system_admin" ||
      !person.user?.isActive ||
      person.userId !== viewer.userId ||
      (ceo && person.role !== "ceo")
    )
      throw new ForbiddenException("Your Ops access changed. Sign in again.");
  }
  private audit(
    tx: Prisma.TransactionClient,
    viewer: Viewer,
    action: string,
    id: string,
    value: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        ...auditActor(viewer),
        action,
        entityType: "ops-weekly",
        entityId: id,
        newValue: value,
      },
    });
  }
  private conflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      throw new ConflictException("Another submission was saved. Reload before trying again.");
    throw error;
  }
}
