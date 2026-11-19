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
import { assertCeo } from "../ops.policy";
import { parse, type Viewer } from "../ops.schemas";
import { WeeklyClock } from "./weekly-clock";
import { syncWeeklyTasks } from "./weekly-tasks";
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
        const report = await tx.opsWeeklyReport.findUnique({
          where: {
            staffId_weekStart_phase: {
              staffId: viewer.id,
              weekStart: plan.weekStart,
              phase: "report",
            },
          },
        });
        if (report?.submittedAt)
          throw new ConflictException(
            "This week's report is already submitted. Ask the CEO to return the report before adding tasks to its plan.",
          );
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
    const current = weekOf(nairobiDate(this.clock.now()));
    if (week < schedule.settings.startWeek || week > addDays(current, 7))
      throw new BadRequestException("Choose an enabled reporting week, up to one week ahead.");
    if (phase === "plan" && dto.submission.items.some((item) => item.status !== "planned"))
      throw new BadRequestException("Plan tasks must use Planned status.");
    if (phase === "report" && dto.submission.items.some((item) => item.status === "planned"))
      throw new BadRequestException("Set the outcome of every task.");
    if (dto.submit) {
      if (dto.submission.summary.length < 5)
        throw new BadRequestException("Provide a brief summary of at least five characters.");
      if (!dto.submission.items.length && dto.submission.noWorkReason.length < 5)
        throw new BadRequestException("Add tasks or explain why no work is reported.");
      if (phase === "report" && this.clock.now() < this.reportOpens(week, schedule.settings))
        throw new BadRequestException(
          "It is too early to submit this week's results. Save a draft until the reporting window opens.",
        );
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
        const existing = await tx.opsWeeklyReport.findUnique({
          where: { staffId_weekStart_phase: { staffId: viewer.id, weekStart: week, phase } },
        });
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
        if (existing?.submittedAt || existing?.reviewedAt)
          throw new ConflictException(
            "Submitted records are locked. Ask the CEO to return it for correction.",
          );
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
          const current = await tx.opsTask.findMany({
            where: {
              assignee: viewer.id,
              id: { in: dto.submission.items.map((item) => item.taskId ?? item.id) },
            },
          });
          dto.submission.items = dto.submission.items.map((item) => {
            const task = current.find((row) => row.id === (item.taskId ?? item.id));
            return task
              ? {
                  ...item,
                  subtasks: parse(weeklyItemSchema.shape.subtasks, task.subtasks ?? []),
                  priority:
                    item.priority ?? (task.priority as "Urgent" | "High" | "Medium" | "Low"),
                }
              : item;
          });
          if (plan?.submittedAt) {
            const items = parse(weeklySubmissionSchema, plan.submission).items;
            if (
              items.some(
                (item) =>
                  !dto.submission.items.some(
                    (result) => (result.taskId ?? result.id) === (item.taskId ?? item.id),
                  ),
              )
            )
              throw new BadRequestException(
                "Include an outcome for every task in your submitted plan.",
              );
          }
        }
        const data = {
          submission: dto.submission as Prisma.InputJsonObject,
          submittedAt: dto.submit ? this.clock.now() : null,
          returnedAt: null,
          returnComment: null,
        };
        if (dto.submit) {
          await syncWeeklyTasks(tx, viewer.id, week, phase, dto.submission);
        }
        let id: string;
        if (existing) {
          const changed = await tx.opsWeeklyReport.updateMany({
            where: { id: existing.id, version: dto.version, submittedAt: null, reviewedAt: null },
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
          dto.submit ? "ops.weekly.submitted" : "ops.weekly.draft_saved",
          id,
          { weekStart: week, phase, ...(dto.submit ? { submission: dto.submission } : {}) },
        );
        return { id, version: dto.version + 1, success: true };
      });
      await Promise.all(storageKeys.map((key) => this.storage.delete(key)));
      return result;
    } catch (error) {
      this.conflict(error);
    }
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
      return { success: true };
    });
  }

  async history(viewer: Viewer, id: string) {
    const report = await this.db.opsWeeklyReport.findUnique({ where: { id } });
    if (!report || (viewer.role !== "ceo" && report.staffId !== viewer.id))
      throw new NotFoundException("Weekly report not found.");
    return this.db.auditLog.findMany({
      where: { entityType: "ops-weekly", entityId: id },
      select: { id: true, action: true, newValue: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  serialize(row: OpsWeeklyReport | undefined, settings: WeeklySettings, privateDraft = false) {
    if (!row) return null;
    const submission =
      privateDraft && !row.submittedAt
        ? { summary: "", items: [], blockers: "", nextWeek: "", noWorkReason: "" }
        : parse(weeklySubmissionSchema, row.submission);
    return {
      ...row,
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
        userId: viewer.userId,
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
