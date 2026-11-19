import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email/email.service";
import { StorageService } from "../storage/storage.service";
import { z } from "zod";
import { OpsService } from "./ops.service";
import { parse, type Viewer } from "./ops.schemas";
import { WeeklyService } from "./weekly/weekly.service";
import { weeklyDate, weekSchema } from "./weekly/weekly.schemas";
import { WeeklyClock } from "./weekly/weekly-clock";
import { escapeHtml } from "../reports/report-email.util";
import { randomUUID } from "node:crypto";
import { auditActor } from "./ops-session";

@Injectable()
export class OpsWorkflowsService {
  private running = false;
  private readonly logger = new Logger(OpsWorkflowsService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly ops: OpsService,
    private readonly weekly: WeeklyService,
    private readonly clock: WeeklyClock,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  leaves(viewer: Viewer, staffId = viewer.id) {
    if (staffId !== viewer.id && viewer.role !== "ceo") throw new NotFoundException();
    return this.db.opsLeave.findMany({ where: { staffId }, orderBy: { start: "desc" } });
  }

  saveLeave(viewer: Viewer, body: unknown, revision: number) {
    const dto = parse(
      z
        .object({
          start: weeklyDate,
          end: weeklyDate,
          note: z.string().trim().max(1000).optional(),
        })
        .strict()
        .refine((row) => row.end >= row.start, "End date must follow start date"),
      body,
    );
    return this.ops.mutate(viewer, revision, async (db) => {
      if (
        await db.opsLeave.findFirst({
          where: { staffId: viewer.id, start: { lte: dto.end }, end: { gte: dto.start } },
        })
      )
        throw new ConflictException("These dates overlap an existing leave record.");
      const leave = await db.opsLeave.create({ data: { ...dto, staffId: viewer.id } });
      await db.auditLog.create({
        data: {
          ...auditActor(viewer),
          action: "ops.leave.recorded",
          entityType: "ops_leave",
          entityId: leave.id,
          newValue: dto,
        },
      });
      return leave;
    });
  }

  removeLeave(viewer: Viewer, id: string, revision: number) {
    return this.ops.mutate(viewer, revision, async (db) => {
      const row = await db.opsLeave.findFirst({ where: { id, staffId: viewer.id } });
      if (!row) throw new NotFoundException();
      await db.opsLeave.delete({ where: { id } });
      await db.auditLog.create({
        data: {
          ...auditActor(viewer),
          action: "ops.leave.removed",
          entityType: "ops_leave",
          entityId: id,
        },
      });
      return { success: true };
    });
  }

  schedules(viewer: Viewer) {
    return this.db.opsSubmissionSchedule.findMany({
      where: { staffId: viewer.id },
      orderBy: { runAt: "desc" },
    });
  }

  schedule(viewer: Viewer, body: unknown, revision: number) {
    const dto = parse(
      z
        .object({
          kind: z.enum(["plan", "report", "monthly"]),
          target: z.string().max(100),
          runAt: z.string().datetime({ offset: true }),
        })
        .strict(),
      body,
    );
    const runAt = new Date(dto.runAt);
    if (runAt <= this.clock.now())
      throw new BadRequestException("Choose a future submission time.");
    if (dto.kind === "monthly") parse(z.string().uuid(), dto.target);
    else parse(weekSchema, dto.target);
    return this.ops.mutate(viewer, revision, async (db) => {
      const draft =
        dto.kind === "monthly"
          ? await db.opsReport.findFirst({
              where: { id: dto.target, author: viewer.id, status: "draft" },
            })
          : await db.opsWeeklyReport.findFirst({
              where: {
                staffId: viewer.id,
                weekStart: dto.target,
                phase: dto.kind,
                submittedAt: null,
              },
            });
      if (!draft) throw new BadRequestException("Save an editable draft before scheduling it.");
      const key = { staffId: viewer.id, kind: dto.kind, target: dto.target };
      const existing = await db.opsSubmissionSchedule.findUnique({
        where: { staffId_kind_target: key },
      });
      if (existing?.status === "processing")
        throw new ConflictException("Submission is already processing.");
      const row = await db.opsSubmissionSchedule.upsert({
        where: { staffId_kind_target: key },
        create: { ...key, runAt },
        update: {
          runAt,
          status: "pending",
          reminderState: "pending",
          lastError: null,
          leaseUntil: null,
        },
      });
      await db.auditLog.create({
        data: {
          ...auditActor(viewer),
          action: "ops.submission.scheduled",
          entityType: "ops_schedule",
          entityId: row.id,
          newValue: dto,
        },
      });
      return row;
    });
  }

  cancel(viewer: Viewer, id: string, revision: number) {
    return this.ops.mutate(viewer, revision, async (db) => {
      const changed = await db.opsSubmissionSchedule.updateMany({
        where: { id, staffId: viewer.id, status: { in: ["pending", "failed"] } },
        data: { status: "cancelled" },
      });
      if (!changed.count) throw new ConflictException("This schedule cannot be cancelled.");
      return { success: true };
    });
  }

  async versions(viewer: Viewer, id: string) {
    await this.ops.document(viewer, id);
    return this.db.opsDocumentVersion.findMany({
      where: { documentId: id },
      select: {
        id: true,
        version: true,
        name: true,
        mime: true,
        size: true,
        createdAt: true,
        uploadedBy: true,
      },
      orderBy: { version: "desc" },
    });
  }

  async versionContent(viewer: Viewer, id: string, version: number) {
    await this.ops.document(viewer, id);
    const row = await this.db.opsDocumentVersion.findUnique({
      where: { documentId_version: { documentId: id, version } },
    });
    if (!row) throw new NotFoundException("Document version not found.");
    return row;
  }

  async uploadVersion(
    viewer: Viewer,
    id: string,
    file: Express.Multer.File | undefined,
    revision: number,
  ) {
    if (!file?.size) throw new BadRequestException("Choose a non-empty file.");
    const key = `ops/documents/${id}/${randomUUID()}`;
    await this.storage.write(key, file.buffer);
    try {
      return await this.ops.mutate(viewer, revision, async (db) => {
        const doc = await db.opsDocument.findUnique({ where: { id } });
        if (!doc || (doc.owner !== viewer.id && viewer.role !== "ceo"))
          throw new NotFoundException();
        if (doc.weeklyRef || doc.report)
          throw new BadRequestException(
            "Submission attachments are retained as submitted. Upload a new attachment to an editable draft.",
          );
        const version = doc.version + 1;
        const name =
          Array.from(file.originalname)
            .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
            .join("")
            .slice(0, 200) || doc.name;
        await db.opsDocumentVersion.create({
          data: {
            documentId: id,
            version,
            name,
            storageKey: key,
            mime: file.mimetype,
            size: file.size,
            uploadedBy: viewer.id,
          },
        });
        await db.opsDocument.update({
          where: { id },
          data: {
            version,
            name,
            storageKey: key,
            mime: file.mimetype,
            size: file.size,
            updated: this.clock.now().toISOString().slice(0, 10),
          },
        });
        await db.auditLog.create({
          data: {
            ...auditActor(viewer),
            action: "ops.document.version_uploaded",
            entityType: "ops_document",
            entityId: id,
            newValue: { version },
          },
        });
        return { version };
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => {});
      throw error;
    }
  }

  @Interval(30000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.clock.now();
      await this.db.opsSubmissionSchedule.updateMany({
        where: { status: "processing", leaseUntil: { lt: now } },
        data: { status: "pending", leaseUntil: null },
      });
      const rows = await this.db.opsSubmissionSchedule.findMany({
        where: { status: "pending", runAt: { lte: new Date(now.getTime() + 3600000) } },
        orderBy: { runAt: "asc" },
        take: 100,
      });
      for (const row of rows) {
        const staff = await this.db.opsStaff.findUnique({
          where: { id: row.staffId },
          include: { user: true },
        });
        if (!staff?.active || !staff.user?.isActive) {
          await this.db.opsSubmissionSchedule.updateMany({
            where: { id: row.id, status: "pending" },
            data: { status: "failed", lastError: "The staff account is inactive." },
          });
          continue;
        }
        const viewer: Viewer = {
          ...staff,
          dept: staff.dept,
          email: staff.user.email,
          sessionId: "scheduler",
        };
        if (row.runAt > now) {
          if (this.config.get("OPS_EMAIL_JOBS_ENABLED") !== true || !this.email.isConfigured())
            continue;
          const claimed = await this.db.opsSubmissionSchedule.updateMany({
            where: { id: row.id, status: "pending", runAt: row.runAt, reminderState: "pending" },
            data: { reminderState: "sending" },
          });
          if (!claimed.count) continue;
          const origin = this.config.get<string>("OPS_FRONTEND_URL") ?? "";
          const link =
            row.kind === "monthly"
              ? `${origin}/reports`
              : `${origin}/weekly-reports?week=${encodeURIComponent(row.target)}&phase=${row.kind}`;
          const sent = await this.email.send(
            staff.user.email,
            "Your scheduled Ops submission is due soon",
            `<p>Your ${row.kind} is scheduled for ${escapeHtml(row.runAt.toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }))} EAT.</p><p>You can update your saved draft before it is automatically submitted.</p><p><a href="${escapeHtml(link)}">Open your draft</a></p>`,
          );
          await this.db.opsSubmissionSchedule.updateMany({
            where: { id: row.id, runAt: row.runAt, reminderState: "sending" },
            data: { reminderState: sent ? "sent" : "failed" },
          });
          continue;
        }
        const claimed = await this.db.opsSubmissionSchedule.updateMany({
          where: { id: row.id, status: "pending", runAt: row.runAt },
          data: { status: "processing", leaseUntil: new Date(now.getTime() + 120000) },
        });
        if (!claimed.count) continue;
        try {
          if (row.kind === "monthly") {
            const snapshot = await this.ops.workspace(viewer, row.id);
            const report = snapshot.workspace.reports.find(
              (item) => item.id === row.target && item.author === viewer.id,
            );
            if (!report) throw new NotFoundException("Draft report not found.");
            if (report.status === "draft")
              await this.ops.save(
                viewer,
                "reports",
                { ...report, status: "submitted" },
                snapshot.revision,
                row.id,
              );
          } else {
            const draft = await this.db.opsWeeklyReport.findUnique({
              where: {
                staffId_weekStart_phase: {
                  staffId: viewer.id,
                  weekStart: row.target,
                  phase: row.kind as "plan" | "report",
                },
              },
            });
            if (!draft) throw new NotFoundException("Draft not found.");
            if (!draft.submittedAt)
              await this.weekly.save(viewer, row.target, row.kind, {
                version: draft.version,
                submit: true,
                submission: draft.submission,
              });
          }
          await this.db.opsSubmissionSchedule.update({
            where: { id: row.id },
            data: { status: "completed", leaseUntil: null, lastError: null },
          });
        } catch (error) {
          const conflict = error instanceof ConflictException;
          await this.db.opsSubmissionSchedule.update({
            where: { id: row.id },
            data: {
              status: conflict ? "pending" : "failed",
              leaseUntil: null,
              lastError: (error instanceof Error ? error.message : "Submission failed").slice(
                0,
                500,
              ),
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        "Ops submission scheduling failed",
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.running = false;
    }
  }
}
