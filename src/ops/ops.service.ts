import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email/email.service";
import { StorageService } from "../storage/storage.service";
import { sanitizeRichText, stripHtml } from "../common/sanitize";
import { sanitizeTaskDescription } from "./task-sanitization";
import { checklistStatus, submittedTaskStatus, hasDeliverables } from "./task-content";
import { hashToken } from "./ops-auth.service";
import { auditActor, loadOpsSession } from "./ops-session";
import { OpsRepository, type OpsTransaction } from "./ops.repository";
import { weeklySubmissionSchema, weekSchema } from "./weekly/weekly.schemas";
import { linkTaskToPlan } from "./weekly/weekly-plan-tasks";
import { nairobiDate, weekOf } from "./weekly/weekly-calendar";
import { WeeklyClock } from "./weekly/weekly-clock";
import { delegationWeek, forwardTaskPeriod } from "./task-planning";
import { syncDeliverableCarryovers } from "./deliverable-carryovers";
import { checklistNodes } from "./deliverable-carryovers";
import {
  deliverableSelection,
  delegatedDescription,
  delegatedTaskDescription,
  preserveDelegatedDescription,
  requestedDeliverableDescription,
  updateDelegatedDrafts,
} from "./deliverable-delegation";
import {
  assertCeo,
  assertSystemAdmin,
  authorizeWrite,
  canReadBusiness,
  canReadDocument,
  validateWorkspace,
  visibleWorkspace,
} from "./ops.policy";
import {
  inviteSchema,
  parse,
  schemas,
  settingsSchema,
  type Collection,
  type Records,
  type Viewer,
  type Workspace,
} from "./ops.schemas";

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: OpsRepository,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
  ) {}

  async workspace(viewer: Viewer, scheduledId?: string) {
    const initialized = await this.prisma.opsState.findUnique({ where: { id: "workspace" } });
    if (!initialized)
      throw new ServiceUnavailableException(
        "Ops is not initialized. Run the Ops bootstrap command.",
      );
    return this.prisma.$transaction(
      async (db) => {
        await this.assertCurrentAccess(db, viewer, scheduledId);
        const data = await this.repository.load(db);
        const submitted =
          viewer.role === "ceo"
            ? await db.opsWeeklyReport.findMany({
                where: { submittedAt: { not: null } },
                select: { staffId: true, weekStart: true, phase: true, submission: true },
              })
            : [];
        const publishedTasks = new Set(
          submitted
            .filter((row) => row.phase === "plan")
            .flatMap((row) =>
              parse(weeklySubmissionSchema, row.submission).items.map(
                (item) => `${row.staffId}:${item.taskId ?? item.id}`,
              ),
            ),
        );
        const workspace = visibleWorkspace(viewer, data.workspace, publishedTasks);
        if (viewer.role === "ceo") {
          const refs = new Set(
            submitted.map((row) => `weekly:${row.staffId}:${row.weekStart}:${row.phase}`),
          );
          workspace.documents = workspace.documents.filter(
            (doc) => !doc.weeklyRef || doc.owner === viewer.id || refs.has(doc.weeklyRef),
          );
        }
        return { workspace, revision: data.revision };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async mutate<T>(
    viewer: Viewer,
    revision: number,
    action: (db: OpsTransaction, data: Workspace) => Promise<T>,
    scheduledId?: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (db) => {
          const changed = await db.opsState.updateMany({
            where: { id: "workspace", revision },
            data: { revision: { increment: 1 } },
          });
          if (!changed.count)
            throw new ConflictException(
              "The workspace changed. Reload it and review your changes before saving again.",
            );
          await this.assertCurrentAccess(db, viewer, scheduledId);
          const { workspace } = await this.repository.load(db);
          return action(db, workspace);
        },
        { maxWait: 10000, timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2003")
          throw new BadRequestException(
            "This record is still linked to other records. Remove those links first.",
          );
        if (error.code === "P2002")
          throw new ConflictException("A record with these details already exists.");
        if (error.code === "P2034")
          throw new ConflictException("Another change was saved. Reload and try again.");
      }
      throw error;
    }
  }

  async save<K extends Collection>(
    viewer: Viewer,
    collection: K,
    value: unknown,
    revision: number,
    scheduledId?: string,
  ) {
    const record = parse(schemas[collection] as unknown as z.ZodType<Records[K]>, value);
    const richFields = new Set(
      collection === "tasks"
        ? ["description"]
        : collection === "projects"
          ? ["summary"]
          : collection === "reports"
            ? []
            : [],
    );
    for (const field of ["summary", "description", "progress", "blockers", "next"]) {
      const values = record as unknown as Record<string, unknown>;
      if (!richFields.has(field) && typeof values[field] === "string")
        values[field] = stripHtml(values[field]);
    }
    if (
      scheduledId &&
      (collection !== "reports" ||
        !(await this.prisma.opsSubmissionSchedule.findFirst({
          where: {
            id: scheduledId,
            staffId: viewer.id,
            target: record.id,
            kind: "monthly",
            status: "processing",
          },
        })))
    )
      throw new ForbiddenException("This scheduled submission is no longer active.");
    if (collection === "projects") {
      const project = record as Records["projects"];
      project.summary = sanitizeRichText(project.summary);
      if (!project.summary.trim())
        throw new BadRequestException("Project summary must contain readable content.");
    } else if (collection === "tasks") {
      const task = record as Records["tasks"];
      task.title = stripHtml(task.title);
      task.description = sanitizeTaskDescription(task.description, task.subtasks);
      task.subtasks = [];
      task.status = checklistStatus(task.description, task.status);
      if (task.weekStart) task.weekStart = weekOf(task.weekStart);
    } else if (collection === "reports") {
      const report = record as Records["reports"];
      report.progress = report.progress === undefined ? undefined : stripHtml(report.progress);
      report.blockers = report.blockers === undefined ? undefined : stripHtml(report.blockers);
      report.next = report.next === undefined ? undefined : stripHtml(report.next);
    }
    parse(schemas[collection] as unknown as z.ZodType<Records[K]>, record);
    return this.mutate(
      viewer,
      revision,
      async (db, data) => {
        const previous = (data[collection] as Records[K][]).find((row) => row.id === record.id);
        authorizeWrite(viewer, collection, record, previous, data);
        if (collection === "tasks") {
          const task = record as Records["tasks"];
          const old = previous as Records["tasks"] | undefined;
          task.description = preserveDelegatedDescription(
            task.description ?? "",
            old?.description ?? "",
          );
          task.requiresDeliverables = old ? (old.requiresDeliverables ?? false) : true;
          if (task.requiresDeliverables && !hasDeliverables(task.description))
            throw new BadRequestException(
              "Add at least one named checklist deliverable before saving this task.",
            );
          task.status = submittedTaskStatus(
            task.description ?? "",
            task.status,
            old?.status === "Done" && old.weekStart === task.weekStart,
          );
        }
        if (collection === "documents") {
          if (!previous) throw new BadRequestException("Use Upload document to attach a file.");
          const doc = record as Records["documents"];
          const old = previous as Records["documents"];
          if (
            doc.owner !== old.owner ||
            doc.fileKey !== old.fileKey ||
            doc.mime !== old.mime ||
            doc.task !== old.task ||
            doc.report !== old.report ||
            doc.weeklyRef !== old.weeklyRef
          )
            throw new BadRequestException(
              "File ownership, content and attachment association cannot be changed through document metadata.",
            );
          if (
            (old.weeklyRef || old.report) &&
            (doc.access !== "restricted" || doc.allowed?.some((personId) => personId !== old.owner))
          )
            throw new BadRequestException(
              "Submission attachments must remain private to their author and the CEO.",
            );
        }
        if (collection === "tasks" && viewer.role !== "ceo") {
          const task = record as Records["tasks"];
          const old = previous as Records["tasks"] | undefined;
          if (task.ceoComment !== old?.ceoComment)
            throw new BadRequestException("Only the CEO can add or change a task comment.");
        }
        if (collection === "reports") {
          const report = record as Records["reports"];
          const old = previous as Records["reports"] | undefined;
          if (old?.reviewed)
            throw new BadRequestException("Reviewed reports are locked. Submit a new update.");
          if (report.reviewed || report.comment)
            throw new BadRequestException("Use the report review action to record a review.");
          if (old && old.author !== report.author)
            throw new BadRequestException("Report authors cannot be changed.");
          if (old && old.status !== "draft" && report.status === "draft")
            throw new BadRequestException("Submitted reports cannot be changed back to drafts.");
          report.month ??= report.date.slice(0, 7);
          report.status ??= "submitted";
          const selected = data.tasks.filter((task) => report.taskIds?.includes(task.id));
          if (
            selected.length !== new Set(report.taskIds ?? []).size ||
            selected.some((task) => task.assignee !== viewer.id)
          )
            throw new BadRequestException("Select only your own current tasks.");
          if (
            (report.attachments ?? []).some(
              (id) =>
                !data.documents.some(
                  (doc) => doc.id === id && doc.owner === viewer.id && doc.report === report.id,
                ),
            )
          )
            throw new BadRequestException(
              "Upload attachments for this report before selecting them.",
            );
          if (report.status === "submitted" && (!report.progress?.trim() || !report.title.trim()))
            throw new BadRequestException("Add your progress before submitting the report.");
          report.taskSnapshots = selected.map((task) => ({
            id: task.id,
            title: task.title,
            description: sanitizeTaskDescription(task.description, task.subtasks),
            status: task.status,
            due: task.due,
            source: task.source ?? "project",
            priority: task.priority,
            subtasks: task.subtasks ?? [],
          }));
          const monthEnd = new Date(`${report.month}-01T12:00:00Z`);
          monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
          monthEnd.setUTCDate(0);
          const startOfMonth = `${report.month}-01`;
          const endOfMonth = monthEnd.toISOString().slice(0, 10);
          report.leaveSnapshot = (
            await db.opsLeave.findMany({
              where: { staffId: viewer.id, start: { lte: endOfMonth }, end: { gte: startOfMonth } },
            })
          ).map(({ start, end, note }) => ({
            start: start < startOfMonth ? startOfMonth : start,
            end: end > endOfMonth ? endOfMonth : end,
            note,
          }));
        }
        const next = {
          ...data,
          [collection]: [
            ...(data[collection] as Records[K][]).filter((row) => row.id !== record.id),
            record,
          ],
        };
        validateWorkspace(next);
        await this.repository.save(db, collection, record);
        if (collection === "tasks") {
          const task = record as Records["tasks"];
          const now = new WeeklyClock(this.config).now();
          await syncDeliverableCarryovers(
            db,
            viewer,
            task,
            previous as Records["tasks"] | undefined,
            task.weekStart ?? weekOf(nairobiDate(now)),
            now,
          );
        }
        const planLink =
          collection === "tasks"
            ? await linkTaskToPlan(
                db,
                viewer,
                record as Records["tasks"],
                previous as Records["tasks"] | undefined,
                new WeeklyClock(this.config).now(),
              )
            : undefined;
        await this.audit(
          db,
          viewer,
          `ops.${collection}.${previous ? "updated" : "created"}`,
          record.id,
          previous,
          record,
        );
        return { id: record.id, ...(planLink ? { planLink } : {}) };
      },
      scheduledId,
    );
  }

  async remove(viewer: Viewer, collection: Collection, id: string, revision: number) {
    const storageKeys: string[] = [];
    await this.mutate(viewer, revision, async (db, data) => {
      const previous = data[collection].find((row) => row.id === id);
      if (!previous) throw new NotFoundException("Record not found.");
      authorizeWrite(viewer, collection, previous, previous, data, true);
      if (collection === "people") {
        const staff = await this.managedStaff(db, id);
        const linked =
          data.projects.some((row) => row.lead === id || row.members.includes(id)) ||
          data.tasks.some((row) => row.assignee === id) ||
          data.reports.some((row) => row.author === id) ||
          data.tenders.some((row) => row.members.includes(id)) ||
          data.clients.some((row) => row.assignees?.includes(id)) ||
          data.clientRequests.some((row) => row.handler === id) ||
          data.documents.some((row) => row.owner === id || row.allowed?.includes(id)) ||
          data.moduleRecords.some((row) => row.owner === id);
        const history = await Promise.all([
          db.opsWeeklyReport.count({ where: { OR: [{ staffId: id }, { reviewerId: id }] } }),
          db.opsReportReview.count({ where: { reviewerId: id } }),
          db.opsWeeklyDelivery.count({ where: { recipientId: id } }),
          db.opsDocumentVersion.count({ where: { uploadedBy: id } }),
          db.opsLeave.count({ where: { staffId: id } }),
        ]);
        if (linked || history.some(Boolean))
          throw new BadRequestException(
            "This staff member has linked work or reporting history. Deactivate or delete their Ops account to remove access while keeping the staff record.",
          );
        await db.opsPasswordReset.deleteMany({ where: { staffId: id } });
        await db.opsSubmissionSchedule.deleteMany({ where: { staffId: id } });
        if (staff.userId) await this.invalidateStaffAccess(db, id, staff.userId);
      }
      if (collection === "departments" || (collection === "businesses" && id === "b0"))
        throw new BadRequestException("This workspace record cannot be deleted.");
      if (collection === "reports" && (previous as Records["reports"]).reviewed)
        throw new BadRequestException("Reviewed reports are retained for review history.");
      validateWorkspace({
        ...data,
        [collection]: data[collection].filter((row) => row.id !== id),
        ...(collection === "people"
          ? {
              accounts: data.accounts.filter((row) => row.personId !== id),
              businessAccess: data.businessAccess.filter((row) => row.person !== id),
              staffBusiness: data.staffBusiness.filter((row) => row.person !== id),
            }
          : {}),
        ...(collection === "tasks"
          ? { documents: data.documents.filter((document) => document.task !== id) }
          : {}),
      });
      if (collection === "documents") {
        const document = previous as Records["documents"];
        if (
          document.report &&
          data.reports.some(
            (report) => report.id === document.report && report.attachments?.includes(id),
          )
        )
          throw new BadRequestException("Remove this attachment from an editable report first.");
        if (document.weeklyRef) {
          const [, staffId, weekStart, phase] = document.weeklyRef.split(":");
          if (staffId && weekStart && (phase === "plan" || phase === "report")) {
            const weekly = await db.opsWeeklyReport.findUnique({
              where: {
                staffId_weekStart_phase: { staffId, weekStart, phase },
              },
              select: { submission: true },
            });
            const submission = weekly && weeklySubmissionSchema.safeParse(weekly.submission);
            if (submission?.success && submission.data.attachments?.includes(id))
              throw new BadRequestException(
                "Weekly submission attachments must be removed from an editable draft first.",
              );
          }
        }
        const file = await db.opsDocument.findUniqueOrThrow({
          where: { id },
          include: { versions: true },
        });
        storageKeys.push(
          ...new Set([file.storageKey, ...file.versions.map((version) => version.storageKey)]),
        );
      } else if (collection === "tasks") {
        const task = previous as Records["tasks"];
        await linkTaskToPlan(
          db,
          viewer,
          { ...task, weekStart: undefined },
          task,
          new WeeklyClock(this.config).now(),
          undefined,
          true,
        );
        const attachments = await db.opsDocument.findMany({
          where: { task: id },
          select: { id: true, storageKey: true },
        });
        storageKeys.push(...attachments.map((document) => document.storageKey));
        await db.opsDocument.deleteMany({ where: { task: id } });
        for (const document of attachments)
          await this.audit(db, viewer, "ops.documents.deleted", document.id);
      }
      await this.repository.remove(db, collection, id);
      await this.audit(db, viewer, `ops.${collection}.deleted`, id, previous);
    });
    await Promise.all(storageKeys.map((key) => this.storage.delete(key)));
    return { success: true };
  }

  review(viewer: Viewer, id: string, comment: string | undefined, revision: number) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db, data) => {
      const report = data.reports.find((row) => row.id === id);
      if (!report) throw new NotFoundException("Report not found.");
      if (report.reviewed || report.status === "draft")
        throw new ConflictException("Only submitted, unreviewed reports can be reviewed.");
      await db.opsReportReview.create({
        data: { reportId: id, reviewerId: viewer.id, comment: comment?.trim() || null },
      });
      await db.opsReport.update({
        where: { id },
        data: { reviewed: true, comment: comment?.trim() || null },
      });
      await this.audit(db, viewer, "ops.reports.reviewed", id, report, {
        ...report,
        reviewed: true,
        comment,
      });
      return { success: true };
    });
  }

  commentTask(viewer: Viewer, id: string, comment: string, revision: number) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db, data) => {
      const task = data.tasks.find((row) => row.id === id);
      if (!task) throw new NotFoundException("Task not found.");
      const ceoComment = comment.trim() || null;
      await db.opsTask.update({ where: { id }, data: { ceoComment } });
      await this.audit(db, viewer, "ops.tasks.commented", id, task.ceoComment, ceoComment);
      return { success: true };
    });
  }

  forwardTask(viewer: Viewer, id: string, revision: number) {
    if (viewer.role !== "staff" && viewer.role !== "ceo")
      throw new ForbiddenException("Operational staff access is required.");
    return this.mutate(viewer, revision, async (db, data) => {
      const task = data.tasks.find((row) => row.id === id);
      if (!task || (viewer.role !== "ceo" && task.assignee !== viewer.id))
        throw new NotFoundException("Assigned task not found.");
      if (task.status === "Done" || task.status === "Cancelled")
        throw new BadRequestException("Completed or cancelled tasks cannot be moved forward.");
      const now = new WeeklyClock(this.config).now();
      const next = {
        ...task,
        ...forwardTaskPeriod(task, now),
      };
      await db.opsTask.update({
        where: { id },
        data: { weekStart: next.weekStart, due: next.due },
      });
      await linkTaskToPlan(db, viewer, next, task, now);
      await this.audit(db, viewer, "ops.tasks.forwarded", id, task, next);
      return { success: true, weekStart: next.weekStart, due: next.due };
    });
  }

  async delegationRecipients(
    viewer: Viewer,
    id: string,
    context?: { project?: string; business?: string },
  ) {
    if (viewer.role !== "staff") throw new ForbiddenException("Staff access is required.");
    const { workspace } = await this.workspace(viewer);
    const existing = workspace.tasks.find((row) => row.id.toLowerCase() === id.toLowerCase());
    if (existing && existing.assignee !== viewer.id)
      throw new NotFoundException("Assigned task not found.");
    if (!existing && !context) throw new NotFoundException("Assigned task not found.");
    const task =
      existing ??
      parse(
        z
          .object({
            project: z.string().uuid().or(z.literal("")).optional(),
            business: z.string().uuid().or(z.literal("b0")).optional(),
          })
          .strict(),
        context,
      );
    if (
      !existing &&
      (!canReadBusiness(viewer, workspace, task.business) ||
        (task.project &&
          !workspace.projects.some(
            (project) => project.id === task.project && project.members.includes(viewer.id),
          )))
    )
      throw new ForbiddenException("Choose an assigned business and project for this deliverable.");
    return this.prisma.opsStaff.findMany({
      where: {
        id: { not: viewer.id },
        role: "staff",
        active: true,
        user: { isActive: true },
        ...(task.project ? { memberships: { some: { projectId: task.project } } } : {}),
        ...(task.business && task.business !== "b0"
          ? { businessGrants: { some: { businessId: task.business } } }
          : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  delegateTask(viewer: Viewer, id: string, value: unknown, revision: number) {
    if (viewer.role !== "staff")
      throw new ForbiddenException("Only staff can delegate their assigned tasks.");
    const dto = parse(
      z
        .object({
          assignee: z.string().uuid(),
          deliverableId: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,100}$/)
            .optional(),
          weekStart: weekSchema.optional(),
          source: schemas.tasks.optional(),
        })
        .strict(),
      value,
    );
    return this.mutate(viewer, revision, async (db, data) => {
      let task = data.tasks.find((row) => row.id.toLowerCase() === id.toLowerCase());
      if (dto.deliverableId && dto.source) {
        if (
          dto.source.id.toLowerCase() !== id.toLowerCase() ||
          dto.source.assignee !== viewer.id ||
          (task && task.assignee !== viewer.id)
        )
          throw new NotFoundException("Assigned task not found.");
        const draft = sanitizeTaskDescription(dto.source.description, dto.source.subtasks);
        const selection = deliverableSelection(draft, dto.deliverableId);
        if (
          !hasDeliverables(selection.html) ||
          ["completed", "cancelled", "forwarded", "postponed", "delegated"].includes(
            selection.node.status,
          )
        )
          throw new BadRequestException("Choose a named, open deliverable to delegate.");
        if (
          checklistNodes(selection.html).some((node) =>
            ["forwarded", "postponed"].includes(node.status),
          ) ||
          checklistNodes(task?.description ?? "").some(
            (node) =>
              checklistNodes(selection.html).some((selected) => selected.id === node.id) &&
              ["forwarded", "postponed"].includes(node.status),
          )
        )
          throw new ConflictException(
            "Undo the existing carryover and save its update before delegating this deliverable.",
          );
        const description = preserveDelegatedDescription(
          requestedDeliverableDescription(task?.description ?? "", draft, dto.deliverableId),
          task?.description ?? "",
        );
        const next = {
          ...(task ?? dto.source),
          id: task?.id ?? dto.source.id.toLowerCase(),
          title: task?.title ?? stripHtml(dto.source.title),
          weekStart:
            task?.weekStart ?? (dto.source.weekStart ? weekOf(dto.source.weekStart) : undefined),
          description,
          ceoComment: task?.ceoComment,
          subtasks: [],
          requiresDeliverables: task ? (task.requiresDeliverables ?? false) : true,
        };
        if (!next.title.trim())
          throw new BadRequestException("Enter a task title before delegating.");
        next.status = submittedTaskStatus(description, next.status, task?.status === "Done");
        authorizeWrite(viewer, "tasks", next, task, data);
        if (
          !canReadBusiness(viewer, data, next.business) ||
          (next.project &&
            !data.projects.some(
              (project) => project.id === next.project && project.members.includes(viewer.id),
            ))
        )
          throw new ForbiddenException(
            "Choose an assigned business and project for this deliverable.",
          );
        if (description.length > 10000)
          throw new BadRequestException("Shorten the task description before delegating.");
        await this.repository.save(db, "tasks", next);
        task = next;
      }
      if (!task || task.assignee !== viewer.id)
        throw new NotFoundException("Assigned task not found.");
      if (dto.assignee.toLowerCase() === viewer.id.toLowerCase())
        throw new BadRequestException("Choose another staff member to delegate this task to.");
      if (!dto.deliverableId && ["Done", "Cancelled"].includes(task.status))
        throw new BadRequestException("Only open tasks can be delegated.");
      if (await db.opsTaskDelegation.findUnique({ where: { pendingTaskId: id } }))
        throw new ConflictException("This task already has a pending delegation request.");
      const selected = dto.deliverableId
        ? deliverableSelection(task.description ?? "", dto.deliverableId)
        : undefined;
      if (
        selected &&
        (!hasDeliverables(selected.html) ||
          checklistNodes(selected.html).some((node) => !node.id) ||
          new Set(checklistNodes(selected.html).map((node) => node.id)).size !==
            checklistNodes(selected.html).length)
      )
        throw new BadRequestException(
          "Reopen the task editor and name each deliverable before delegating it.",
        );
      if (
        selected &&
        ["completed", "cancelled", "forwarded", "postponed", "delegated"].includes(
          selected.node.status,
        )
      )
        throw new BadRequestException("Choose an open deliverable to delegate.");
      const pending = await db.opsTaskDelegation.findMany({
        where: { taskId: id, status: "pending" },
      });
      const selectedIds = selected
        ? new Set(checklistNodes(selected.html).map((node) => node.id))
        : null;
      if (
        pending.some(
          (request) =>
            !selectedIds ||
            !request.deliverableId ||
            checklistNodes(request.deliverableSnapshot ?? "").some((node) =>
              selectedIds.has(node.id),
            ),
        )
      )
        throw new ConflictException("This deliverable already has a pending delegation request.");
      const recipient = await db.opsStaff.findUnique({
        where: { id: dto.assignee },
        include: { user: { select: { id: true, isActive: true } } },
      });
      if (!recipient?.active || recipient.role !== "staff" || !recipient.user?.isActive)
        throw new BadRequestException("Choose an active staff member with an account.");
      const recipientViewer: Viewer = {
        ...recipient,
        userId: recipient.user.id,
        email: "",
        sessionId: "delegation",
      };
      if (!canReadBusiness(recipientViewer, data, task.business))
        throw new ForbiddenException(
          "The selected staff member cannot access this task's business.",
        );
      if (task.project) {
        const project = data.projects.find((row) => row.id === task.project);
        if (!project?.members.includes(recipient.id))
          throw new BadRequestException(
            "The recipient must be a member of this task's project before delegation.",
          );
      }
      const request = await db.opsTaskDelegation.create({
        data: {
          taskId: task.id,
          pendingTaskId: selected ? null : task.id,
          ...(selected
            ? {
                deliverableId: dto.deliverableId,
                deliverableSnapshot: selected.html,
                deliverableTitle: stripHtml(
                  selected.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "Deliverable",
                ).slice(0, 200),
                pendingDeliverableKey: `${task.id}:${dto.deliverableId}`,
              }
            : {}),
          taskTitle: task.title,
          senderId: viewer.id,
          recipientId: recipient.id,
          weekStart: delegationWeek(
            dto.weekStart ?? task.weekStart,
            new WeeklyClock(this.config).now(),
          ),
        },
      });
      await this.audit(
        db,
        viewer,
        "ops.tasks.delegation_requested",
        request.id,
        undefined,
        request,
      );
      await db.notification.create({
        data: {
          userId: recipient.user.id,
          type: "task_assigned",
          title: "Task delegation awaiting your response",
          body: `${viewer.name} asked you to take on ${selected ? "a deliverable in " : ""}"${task.title}". Accept or decline the request.`,
          resourceType: "ops-delegation",
          resourceId: request.id,
          dedupeKey: `ops-delegation-request:${request.id}`,
          createdBy: viewer.userId ?? null,
        },
      });
      return { id: request.id, status: request.status, weekStart: request.weekStart };
    });
  }

  async taskDelegations(viewer: Viewer) {
    if (viewer.role !== "staff") return [];
    return this.prisma.opsTaskDelegation.findMany({
      where: { OR: [{ senderId: viewer.id }, { recipientId: viewer.id }] },
      include: {
        sender: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  }

  respondToDelegation(viewer: Viewer, id: string, value: unknown, revision: number) {
    if (viewer.role !== "staff") throw new ForbiddenException("Staff access is required.");
    const { decision } = parse(
      z.object({ decision: z.enum(["accepted", "declined", "cancelled"]) }).strict(),
      value,
    );
    return this.mutate(viewer, revision, async (db, data) => {
      const request = await db.opsTaskDelegation.findUnique({ where: { id } });
      if (
        !request ||
        (decision === "cancelled"
          ? request.senderId !== viewer.id
          : request.recipientId !== viewer.id)
      )
        throw new NotFoundException("Delegation request not found.");
      if (request.status === decision) return { success: true, status: decision };
      if (request.status !== "pending")
        throw new ConflictException("This delegation has already been answered.");
      const now = new WeeklyClock(this.config).now();
      const changed = await db.opsTaskDelegation.updateMany({
        where: { id, status: "pending" },
        data: {
          status: decision,
          pendingTaskId: null,
          pendingDeliverableKey: null,
          respondedAt: now,
        },
      });
      if (!changed.count) throw new ConflictException("This delegation has already been answered.");
      if (decision === "accepted") {
        const task = data.tasks.find((row) => row.id === request.taskId);
        if (
          !task ||
          task.assignee !== request.senderId ||
          (!request.deliverableId && ["Done", "Cancelled"].includes(task.status))
        )
          throw new ConflictException(
            "This task has changed and can no longer be accepted. Ask the sender to cancel this request.",
          );
        if (
          !canReadBusiness(viewer, data, task.business) ||
          (task.project &&
            !data.projects.some(
              (row) => row.id === task.project && row.members.includes(viewer.id),
            ))
        )
          throw new ForbiddenException(
            "You need access to the task's business and project before accepting it.",
          );
        if (request.deliverableId) {
          const selected = deliverableSelection(task.description ?? "", request.deliverableId);
          if (selected.html !== request.deliverableSnapshot)
            throw new ConflictException(
              "The sender changed this deliverable. Ask them to cancel the request and send it again.",
            );
          const description = delegatedDescription(task.description ?? "", request.deliverableId);
          const source = {
            ...task,
            description,
            status: submittedTaskStatus(description, task.status, task.status === "Done"),
          };
          const weekStart = delegationWeek(request.weekStart, now);
          const next = {
            ...task,
            id: request.id,
            title: task.title,
            assignee: viewer.id,
            weekStart,
            due:
              task.due < weekStart
                ? `${new Date(new Date(`${weekStart}T12:00:00Z`).getTime() + 4 * 86400000).toISOString().slice(0, 10)}`
                : task.due,
            description: delegatedTaskDescription(selected.html),
            status: "To do",
            source: "planned",
            requiresDeliverables: true,
            ceoComment: undefined,
            subtasks: [],
          };
          if (description.length > 10000 || next.description.length > 10000)
            throw new BadRequestException(
              "Ask the sender to shorten the deliverable instructions before accepting.",
            );
          await db.opsTask.update({
            where: { id: task.id },
            data: { description, status: source.status },
          });
          await db.opsTask.create({
            data: {
              id: next.id,
              title: next.title,
              assignee: next.assignee,
              weekStart: next.weekStart,
              due: next.due,
              description: next.description,
              status: next.status,
              source: next.source,
              requiresDeliverables: true,
              subtasks: [],
              project: task.project || null,
              business: task.business ?? "b0",
              priority: task.priority,
            },
          });
          await linkTaskToPlan(db, viewer, next, undefined, now);
          await updateDelegatedDrafts(db, source, [
            task.weekStart ?? weekOf(task.due),
            request.weekStart,
          ]);
        } else {
          const next = {
            ...task,
            assignee: viewer.id,
            weekStart: delegationWeek(request.weekStart, now),
          };
          await db.opsTask.update({
            where: { id: task.id },
            data: { assignee: next.assignee, weekStart: next.weekStart },
          });
          await linkTaskToPlan(db, viewer, next, task, now);
        }
      }
      const recipientId = decision === "cancelled" ? request.recipientId : request.senderId;
      const person = await db.opsStaff.findUnique({
        where: { id: recipientId },
        select: { userId: true },
      });
      if (person?.userId)
        await db.notification.create({
          data: {
            userId: person.userId,
            type: "task_assigned",
            title: `Task delegation ${decision}`,
            body: `${viewer.name} ${decision} the delegation of "${request.taskTitle}".`,
            resourceType: "ops-delegation",
            resourceId: id,
            dedupeKey: `ops-delegation-${decision}:${id}`,
            createdBy: viewer.userId ?? null,
          },
        });
      await this.audit(db, viewer, `ops.tasks.delegation_${decision}`, id, request, {
        status: decision,
      });
      return { success: true, status: decision };
    });
  }

  async reviewHistory(viewer: Viewer, id: string) {
    const { workspace } = await this.workspace(viewer);
    if (!workspace.reports.some((report) => report.id === id))
      throw new NotFoundException("Report not found.");
    return this.prisma.opsReportReview.findMany({
      where: { reportId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, reviewerId: true, comment: true, createdAt: true },
    });
  }

  async projectNotes(viewer: Viewer, projectId: string) {
    const { workspace } = await this.workspace(viewer);
    if (!workspace.projects.some((project) => project.id === projectId))
      throw new NotFoundException("Project not found.");
    return this.prisma.opsProjectNote.findMany({
      where: { projectId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  addProjectNote(viewer: Viewer, projectId: string, value: unknown, revision: number) {
    if (viewer.role !== "staff")
      throw new ForbiddenException("Only project staff can add a project note.");
    const dto = parse(z.object({ note: z.string().trim().min(1).max(5000) }).strict(), value);
    return this.mutate(viewer, revision, async (db, data) => {
      const project = data.projects.find((row) => row.id === projectId);
      if (!project) throw new NotFoundException("Project not found.");
      if (!project.members.includes(viewer.id))
        throw new ForbiddenException("Only project members can add notes.");
      const note = await db.opsProjectNote.create({
        data: { projectId, staffId: viewer.id, note: dto.note },
        include: { author: { select: { id: true, name: true } } },
      });
      await this.audit(db, viewer, "ops.projects.note_added", note.id, undefined, {
        projectId,
        note: dto.note,
      });
      return note;
    });
  }

  settings(viewer: Viewer, value: unknown, revision: number) {
    assertCeo(viewer);
    const settings = parse(settingsSchema, value);
    return this.mutate(viewer, revision, async (db, data) => {
      await db.opsState.update({ where: { id: "workspace" }, data: { settings } });
      await this.audit(db, viewer, "ops.settings.updated", "workspace", data.settings, settings);
      return { success: true };
    });
  }

  account(viewer: Viewer, id: string, role: "ceo" | "staff", active: boolean, revision: number) {
    if (role === "ceo") assertSystemAdmin(viewer);
    else if (viewer.role !== "ceo" && viewer.role !== "system_admin")
      throw new ForbiddenException("CEO or system administrator access is required.");
    return this.mutate(viewer, revision, async (db, data) => {
      const previous = data.accounts.find((row) => row.id === id);
      if (!previous) throw new NotFoundException("Account not found.");
      if (previous.role === "system_admin")
        throw new BadRequestException(
          "System administrator accounts are managed through bootstrap.",
        );
      if (viewer.role === "ceo" && previous.role !== "staff")
        throw new BadRequestException("CEO account assignments are managed by System Admin.");
      if (role === "ceo" && (!active || !previous.hasPassword))
        throw new BadRequestException("The CEO must have an active account and password.");
      if (viewer.role === "system_admin" && id === viewer.id)
        throw new BadRequestException(
          "Your system administrator profile is managed through bootstrap.",
        );
      validateWorkspace({
        ...data,
        accounts: data.accounts.map((row) => {
          if (row.id === id) return { ...row, role, active };
          if (viewer.role === "system_admin" && role === "ceo" && row.role === "ceo")
            return { ...row, role: "staff" };
          return row;
        }),
      });
      if (viewer.role === "system_admin" && role === "ceo")
        await db.opsStaff.updateMany({
          where: { role: "ceo", id: { not: id } },
          data: { role: "staff" },
        });
      await db.opsStaff.update({ where: { id }, data: { role, active } });
      if (!active) await db.opsSession.deleteMany({ where: { staffId: id } });
      await this.audit(
        db,
        viewer,
        "ops.accounts.updated",
        id,
        { role: previous.role, active: previous.active },
        { role, active },
      );
      return { success: true };
    });
  }

  private async managedStaff(db: OpsTransaction, id: string) {
    const staff = await db.opsStaff.findUnique({ where: { id }, include: { user: true } });
    if (!staff) throw new NotFoundException("Staff member not found.");
    if (staff.role !== "staff")
      throw new ForbiddenException("Only staff accounts can be managed here.");
    return staff;
  }

  private async invalidateStaffAccess(db: OpsTransaction, staffId: string, userId: string) {
    const now = new Date();
    await db.opsSession.deleteMany({ where: { staffId } });
    await db.opsInvitation.updateMany({
      where: { staffId, usedAt: null },
      data: { usedAt: now },
    });
    await db.opsPasswordReset.updateMany({
      where: { staffId, usedAt: null },
      data: { usedAt: now },
    });
    await db.passwordSetupToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
  }

  updateStaff(viewer: Viewer, id: string, value: unknown, revision: number) {
    assertCeo(viewer);
    const dto = parse(
      schemas.people.omit({ id: true }).extend({
        email: z.string().trim().toLowerCase().email().max(200).optional(),
      }),
      value,
    );
    return this.mutate(viewer, revision, async (db, data) => {
      const staff = await this.managedStaff(db, id);
      if (dto.email && !staff.userId)
        throw new BadRequestException("Invite this staff member to create their sign-in account.");
      const emailChanged = dto.email !== undefined && dto.email !== staff.user?.email;
      if (emailChanged) {
        const duplicate = await db.user.findUnique({ where: { email: dto.email } });
        if (duplicate && duplicate.id !== staff.userId)
          throw new ConflictException("Another account already uses this email address.");
      }
      const { email, ...profile } = dto;
      validateWorkspace({
        ...data,
        people: data.people.map((row) => (row.id === id ? { ...row, ...profile } : row)),
      });
      await db.opsStaff.update({ where: { id }, data: profile });
      if (emailChanged && staff.userId) {
        await db.user.update({ where: { id: staff.userId }, data: { email } });
        await this.invalidateStaffAccess(db, id, staff.userId);
      }
      await this.audit(
        db,
        viewer,
        "ops.staff.updated",
        id,
        { name: staff.name, title: staff.title, dept: staff.dept, email: staff.user?.email },
        dto,
      );
      return { success: true };
    });
  }

  removeAccount(viewer: Viewer, id: string, revision: number) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db) => {
      const staff = await this.managedStaff(db, id);
      if (!staff.userId) throw new NotFoundException("Account not found.");
      await this.invalidateStaffAccess(db, id, staff.userId);
      await db.opsSubmissionSchedule.updateMany({
        where: { staffId: id, status: { in: ["pending", "processing", "failed"] } },
        data: { status: "cancelled", leaseUntil: null },
      });
      await db.opsModuleGrant.deleteMany({ where: { staffId: id } });
      await db.opsBusinessGrant.deleteMany({ where: { personId: id } });
      await db.opsStaff.update({ where: { id }, data: { userId: null, active: false } });
      await this.audit(db, viewer, "ops.accounts.deleted", id, { email: staff.user?.email });
      return { success: true };
    });
  }

  businessPermissions(
    viewer: Viewer,
    person: string,
    home: string | null,
    grants: string[],
    revision: number,
    permissions: { business: string; manage?: boolean; finance?: "view" | "manage" }[] = [],
  ) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db, data) => {
      const next = {
        ...data,
        staffBusiness: [
          ...data.staffBusiness.filter((row) => row.person !== person),
          ...(home ? [{ person, business: home }] : []),
        ],
        businessAccess: [
          ...data.businessAccess.filter((row) => row.person !== person),
          ...grants.map((business) => ({
            person,
            business,
            ...permissions.find((row) => row.business === business),
          })),
        ],
      };
      validateWorkspace(next);
      await db.opsBusinessGrant.deleteMany({ where: { personId: person } });
      const rows = [
        ...grants.map((businessId) => ({ personId: person, businessId, kind: "grant" })),
        ...permissions
          .filter((row) => row.manage && grants.includes(row.business))
          .map((row) => ({ personId: person, businessId: row.business, kind: "manage" })),
        ...permissions
          .filter((row) => row.finance && grants.includes(row.business))
          .map((row) => ({
            personId: person,
            businessId: row.business,
            kind: row.finance === "manage" ? "fin_manage" : "fin_view",
          })),
        ...(home ? [{ personId: person, businessId: home, kind: "home" }] : []),
      ];
      if (rows.length) await db.opsBusinessGrant.createMany({ data: rows });
      await this.audit(db, viewer, "ops.business_permissions.updated", person, undefined, {
        home,
        grants,
      });
      return { success: true };
    });
  }

  private frontendUrl() {
    const raw = this.config.get<string>("OPS_FRONTEND_URL");
    if (!raw)
      throw new ServiceUnavailableException("Set OPS_FRONTEND_URL before issuing invitations.");
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (this.config.get("NODE_ENV") === "production" && url.protocol !== "https:")
    )
      throw new ServiceUnavailableException("OPS_FRONTEND_URL must be an HTTPS URL in production.");
    return url.origin;
  }

  async invite(viewer: Viewer, value: unknown, revision: number) {
    const dto = parse(inviteSchema, value);
    if (
      (viewer.role === "ceo" && dto.role !== "staff") ||
      (viewer.role === "system_admin" && dto.role !== "ceo") ||
      (viewer.role !== "ceo" && viewer.role !== "system_admin")
    )
      throw new ForbiddenException("You cannot invite an account with this role.");
    const origin = this.frontendUrl();
    const token = randomBytes(32).toString("hex");
    const result = await this.mutate(viewer, revision, async (db, data) => {
      let person = dto.personId ? data.people.find((row) => row.id === dto.personId) : undefined;
      if (dto.personId && !person) throw new NotFoundException("Staff member not found.");
      if (!person)
        person = parse(schemas.people, {
          id: randomUUID(),
          name: dto.name,
          title: dto.title,
          dept: dto.dept ?? null,
        });
      if (data.accounts.some((account) => account.personId === person.id))
        throw new BadRequestException("This staff member already has an account.");
      let user = await db.user.findUnique({ where: { email: dto.email } });
      if (user && !user.isActive)
        throw new BadRequestException(
          "The shared identity is inactive. Resolve this through the existing account administration.",
        );
      if (user && (await db.opsStaff.findUnique({ where: { userId: user.id } })))
        throw new BadRequestException("This email already has Ops access.");
      if (!user)
        user = await db.user.create({
          data: { email: dto.email, fullName: person.name, jobTitle: person.title },
        });
      await db.opsStaff.upsert({
        where: { id: person.id },
        create: { ...person, userId: user.id, role: dto.role },
        update: { userId: user.id, role: dto.role, active: true },
      });
      await db.opsInvitation.create({
        data: {
          staffId: person.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await this.audit(db, viewer, "ops.staff.invited", person.id, undefined, {
        email: dto.email,
        role: dto.role,
      });
      return { email: dto.email };
    });
    const invitationUrl = `${origin}/login?token=${token}`;
    const emailSent = await this.email.send(
      result.email,
      "Amsol Ops invitation",
      `<p>You have been invited to Amsol Ops.</p><p><a href="${invitationUrl}">Set up your account</a></p><p>This link expires in 7 days.</p>`,
    );
    return { invitationUrl, emailSent };
  }

  async renewInvitation(viewer: Viewer, id: string, revision: number) {
    assertCeo(viewer);
    if (id === viewer.id)
      throw new BadRequestException("Use My account to change your own password.");
    const origin = this.frontendUrl();
    const token = randomBytes(32).toString("hex");
    const result = await this.mutate(viewer, revision, async (db) => {
      const staff = await this.managedStaff(db, id);
      if (!staff?.user?.isActive || !staff.active)
        throw new BadRequestException("Activate the Ops account before renewing its invitation.");
      await db.opsInvitation.updateMany({
        where: { staffId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.opsInvitation.create({
        data: {
          staffId: id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await db.opsSession.deleteMany({ where: { staffId: id } });
      await this.audit(db, viewer, "ops.invitation.renewed", id);
      return staff.user.email;
    });
    const invitationUrl = `${origin}/login?token=${token}`;
    const emailSent = await this.email.send(
      result,
      "Amsol Ops account access",
      `<p><a href="${invitationUrl}">Set your account password</a></p><p>This link expires in 7 days. The password is shared with your existing AIMS identity.</p>`,
    );
    return { invitationUrl, emailSent };
  }

  async setModuleAccess(viewer: Viewer, staffId: string, value: unknown, revision: number) {
    const dto = parse(
      z
        .object({
          module: z.enum(["water", "blog", "ledger", "inventory", "tender"]),
          access: z.enum(["none", "view", "manage"]),
        })
        .strict(),
      value,
    );
    return this.mutate(viewer, revision, async (db) => {
      assertCeo(viewer);
      const staff = await db.opsStaff.findUnique({ where: { id: staffId } });
      if (!staff?.userId) throw new BadRequestException("Choose a staff account.");
      const where = { staffId_module: { staffId, module: dto.module } };
      const previous = await db.opsModuleGrant.findUnique({ where });
      if (dto.access === "none")
        await db.opsModuleGrant.deleteMany({ where: { staffId, module: dto.module } });
      else
        await db.opsModuleGrant.upsert({
          where,
          create: { staffId, module: dto.module, access: dto.access },
          update: { access: dto.access },
        });
      await this.audit(db, viewer, "ops.modules.access", staffId, previous, dto);
      return { success: true };
    });
  }

  async upload(
    viewer: Viewer,
    value: unknown,
    file: Express.Multer.File | undefined,
    revision: number,
  ) {
    if (!file || file.size === 0) throw new BadRequestException("Choose a non-empty file.");
    const record = parse(schemas.documents, value);
    if (record.report) {
      const report = await this.prisma.opsReport.findFirst({
        where: { id: record.report, author: viewer.id, reviewed: false },
      });
      if (
        !report ||
        record.access !== "restricted" ||
        record.allowed?.some((id) => id !== viewer.id)
      )
        throw new BadRequestException("Report attachments must belong to your editable draft.");
    }
    if (
      record.weeklyRef &&
      (record.access !== "restricted" ||
        record.owner !== viewer.id ||
        record.project ||
        record.task ||
        record.dept ||
        record.allowed?.some((personId) => personId !== viewer.id) ||
        !record.weeklyRef.startsWith(`weekly:${viewer.id}:`))
    )
      throw new BadRequestException("Weekly attachments must be private to their author.");
    const key = `ops/documents/${record.id}/${randomUUID()}`;
    await this.storage.write(key, file.buffer);
    try {
      await this.mutate(viewer, revision, async (db, data) => {
        if (
          record.report &&
          !data.reports.some(
            (report) =>
              report.id === record.report && report.author === viewer.id && !report.reviewed,
          )
        )
          throw new BadRequestException("Upload attachments to your editable report.");
        if (data.documents.some((doc) => doc.id === record.id))
          throw new ConflictException("Document already exists.");
        authorizeWrite(viewer, "documents", record, undefined, data);
        if (record.owner !== viewer.id)
          throw new BadRequestException("Uploads must belong to the signed-in staff member.");
        validateWorkspace({ ...data, documents: [...data.documents, record] });
        await db.opsDocument.create({
          data: {
            id: record.id,
            name: record.name,
            folder: record.folder,
            access: record.access,
            owner: viewer.id,
            updated: new Date().toISOString().slice(0, 10),
            project: record.project,
            task: record.task,
            weeklyRef: record.weeklyRef,
            report: record.report,
            dept: record.dept,
            storageKey: key,
            mime: file.mimetype || "application/octet-stream",
            size: file.size,
          },
        });
        await db.opsDocumentVersion.create({
          data: {
            documentId: record.id,
            version: 1,
            name: record.name,
            storageKey: key,
            mime: file.mimetype || "application/octet-stream",
            size: file.size,
            uploadedBy: viewer.id,
          },
        });
        if (record.access === "restricted" && record.allowed?.length)
          await db.opsDocumentGrant.createMany({
            data: record.allowed.map((personId) => ({ documentId: record.id, personId })),
          });
        await this.audit(db, viewer, "ops.documents.uploaded", record.id, undefined, {
          name: record.name,
          size: file.size,
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => {});
      throw error;
    }
    return { id: record.id };
  }

  async document(viewer: Viewer, id: string) {
    const { workspace } = await this.workspace(viewer);
    const doc = workspace.documents.find((row) => row.id === id);
    if (!doc || !canReadDocument(viewer, doc, workspace))
      throw new NotFoundException("Document not found.");
    return this.prisma.opsDocument.findUniqueOrThrow({ where: { id } });
  }

  private async assertCurrentAccess(db: OpsTransaction, viewer: Viewer, scheduledId?: string) {
    if (!scheduledId) {
      const { viewer: current } = await loadOpsSession(
        db,
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
        throw new ConflictException("Your permissions changed. Reload the workspace.");
      return;
    }
    const staff = await db.opsStaff.findUnique({
      where: { id: viewer.id },
      include: { user: { select: { isActive: true } } },
    });
    if (!staff?.active || !staff.user?.isActive)
      throw new UnauthorizedException("Your session has expired. Sign in again.");
    if (
      scheduledId &&
      !(await db.opsSubmissionSchedule.findFirst({
        where: { id: scheduledId, staffId: viewer.id, kind: "monthly", status: "processing" },
      }))
    )
      throw new UnauthorizedException("This scheduled submission is no longer active.");
    if (staff.role !== viewer.role || staff.dept !== viewer.dept)
      throw new ConflictException("Your permissions changed. Reload the workspace.");
  }

  private audit(
    db: OpsTransaction,
    viewer: Viewer,
    action: string,
    id: string,
    previous?: unknown,
    next?: unknown,
  ) {
    return db.auditLog.create({
      data: {
        ...auditActor(viewer),
        action,
        entityType: "ops",
        entityId: id,
        oldValue: previous === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(previous)),
        newValue: next === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(next)),
      },
    });
  }
}
