import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService } from "../../notifications/email/email.service";
import { assertCeo } from "../ops.policy";
import { parse, type Viewer } from "../ops.schemas";
import { WeeklyClock } from "./weekly-clock";
import { addDays, nairobiDate, scheduleFor, weekOf } from "./weekly-calendar";
import { renderWeeklyEmail } from "./weekly-email";
import { phaseSchema, weekSchema, type WeeklyPhase } from "./weekly.schemas";
import { WeeklyService } from "./weekly.service";
import { auditActor } from "../ops-session";

@Injectable()
export class WeeklyDeliveryService {
  private readonly logger = new Logger(WeeklyDeliveryService.name);
  private running = false;
  constructor(
    private readonly db: PrismaService,
    private readonly weekly: WeeklyService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly clock: WeeklyClock,
  ) {}

  readiness() {
    let originReady = true;
    try {
      this.origin();
    } catch {
      originReady = false;
    }
    return {
      smtpConfigured: this.email.isConfigured(),
      scheduledEmailsEnabled: this.config.get("OPS_EMAIL_JOBS_ENABLED") === true,
      originReady,
    };
  }
  async preview(viewer: Viewer, rawWeek: string, rawPhase: string) {
    assertCeo(viewer);
    const phase = parse(phaseSchema, rawPhase);
    const data = await this.weekly.overview(viewer, parse(weekSchema, rawWeek));
    return { ...renderWeeklyEmail(data, phase, this.origin()), data };
  }
  async history(viewer: Viewer) {
    assertCeo(viewer);
    return this.db.opsWeeklyDelivery.findMany({
      where: { recipientId: viewer.id },
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        weekStart: true,
        phase: true,
        status: true,
        attempts: true,
        sentAt: true,
        lastError: true,
        createdAt: true,
        recipient: { select: { name: true } },
      },
    });
  }
  async sendNow(viewer: Viewer, rawWeek: string, rawPhase: string) {
    assertCeo(viewer);
    if (!this.email.isConfigured())
      throw new ServiceUnavailableException("Configure SMTP before sending weekly emails.");
    const schedule = await this.weekly.settings();
    if (!schedule.configured)
      throw new BadRequestException("Save the weekly reporting schedule first.");
    const week = parse(weekSchema, rawWeek);
    const phase = parse(phaseSchema, rawPhase);
    if (week < schedule.settings.startWeek)
      throw new BadRequestException("This week is before weekly reporting started.");
    return this.prepare(viewer, week, phase, false);
  }
  async retry(viewer: Viewer, id: string, acknowledge: boolean) {
    assertCeo(viewer);
    const row = await this.db.opsWeeklyDelivery.findUnique({ where: { id } });
    if (!row || row.recipientId !== viewer.id)
      throw new BadRequestException("This delivery does not belong to your CEO account.");
    if (!["failed", "uncertain"].includes(row.status))
      throw new ConflictException("This delivery is already sent or is still processing.");
    if (row.status === "uncertain" && !acknowledge)
      throw new BadRequestException(
        "Acknowledge that an unconfirmed earlier attempt may already have reached your inbox.",
      );
    const changed = await this.db.opsWeeklyDelivery.updateMany({
      where: { id, status: row.status, attempts: row.attempts },
      data: { status: "pending", leaseToken: null, leaseUntil: null },
    });
    if (!changed.count)
      throw new ConflictException("The delivery changed. Refresh before retrying.");
    await this.db.auditLog.create({
      data: {
        ...auditActor(viewer),
        action: "ops.weekly.email_retry_requested",
        entityType: "ops-weekly-delivery",
        entityId: id,
        metadata: { ...auditActor(viewer).metadata, acknowledgePossibleDuplicate: acknowledge },
      },
    });
    return this.deliver(id);
  }

  @Interval(60000)
  async tick() {
    if (this.running || !this.readiness().scheduledEmailsEnabled) return;
    this.running = true;
    try {
      const now = this.clock.now();
      await this.db.opsWeeklyDelivery.updateMany({
        where: { status: "sending", leaseUntil: { lt: now } },
        data: {
          status: "uncertain",
          lastError: "A send attempt was interrupted. Check the recipient inbox before retrying.",
          leaseToken: null,
          leaseUntil: null,
        },
      });
      const schedule = await this.weekly.settings();
      if (!schedule.configured || !this.email.isConfigured()) return;
      this.origin();
      const recipients = await this.db.opsStaff.findMany({
        where: { active: true, role: "ceo", user: { isActive: true, passwordHash: { not: null } } },
        include: { user: { select: { email: true } } },
      });
      for (let offset = 2; offset >= 0; offset--) {
        const week = addDays(weekOf(nairobiDate(now)), -offset * 7);
        if (week < schedule.settings.startWeek) continue;
        for (const phase of ["plan", "report"] as const) {
          const due = scheduleFor(week, phase, schedule.settings);
          if (
            !due.enabled ||
            due.delivery > now ||
            now.getTime() - due.delivery.getTime() > 14 * 86400000
          )
            continue;
          for (const staff of recipients) {
            const viewer: Viewer = {
              ...staff,
              dept: staff.dept as Viewer["dept"],
              userId: staff.userId!,
              sessionId: "scheduler",
              email: staff.user!.email,
            };
            await this.prepare(viewer, week, phase, true);
          }
        }
      }
    } catch (error) {
      this.logger.error(
        "Weekly email processing failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      this.running = false;
    }
  }

  private async prepare(viewer: Viewer, week: string, phase: WeeklyPhase, scheduled: boolean) {
    const existing = await this.db.opsWeeklyDelivery.findUnique({
      where: { recipientId_weekStart_phase: { recipientId: viewer.id, weekStart: week, phase } },
    });
    if (existing) {
      if (scheduled)
        return existing.status === "pending"
          ? this.deliver(existing.id)
          : { id: existing.id, status: existing.status };
      throw new ConflictException(
        "A brief for this week and phase already exists. Check delivery history instead of sending a duplicate.",
      );
    }
    const rendered = await this.preview(viewer, week, phase);
    const id = randomUUID();
    try {
      await this.db.opsWeeklyDelivery.create({
        data: {
          id,
          recipientId: viewer.id,
          weekStart: week,
          phase,
          subject: rendered.subject,
          html: rendered.html,
          plainText: rendered.text,
          messageId: `<ops-weekly-${id}@${new URL(this.origin()).hostname}>`,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        if (scheduled) return { status: "already_queued" };
        throw new ConflictException("This brief has already been queued.");
      }
      throw error;
    }
    await this.db.auditLog.create({
      data: {
        ...auditActor(viewer),
        action: scheduled ? "ops.weekly.email_scheduled" : "ops.weekly.email_requested",
        entityType: "ops-weekly-delivery",
        entityId: id,
        metadata: { ...auditActor(viewer).metadata, week, phase },
      },
    });
    return this.deliver(id);
  }
  private async deliver(id: string) {
    const token = randomUUID();
    const claimed = await this.db.opsWeeklyDelivery.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "sending",
        leaseToken: token,
        leaseUntil: new Date(this.clock.now().getTime() + 120000),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return { id, status: "already_processing" };
    const row = await this.db.opsWeeklyDelivery.findUniqueOrThrow({
      where: { id },
      include: { recipient: { include: { user: { select: { email: true, isActive: true } } } } },
    });
    if (
      !row.recipient.active ||
      row.recipient.role !== "ceo" ||
      !row.recipient.user?.isActive ||
      !this.email.isConfigured()
    ) {
      await this.db.opsWeeklyDelivery.updateMany({
        where: { id, leaseToken: token },
        data: {
          status: "failed",
          lastError: "Recipient access or SMTP configuration is unavailable.",
          leaseToken: null,
          leaseUntil: null,
        },
      });
      return { id, status: "failed" };
    }
    const sent = await this.email.send(row.recipient.user.email, row.subject, row.html, {
      text: row.plainText,
      messageId: row.messageId,
    });
    await this.db.opsWeeklyDelivery.updateMany({
      where: { id, leaseToken: token },
      data: {
        status: sent ? "sent" : "uncertain",
        sentAt: sent ? this.clock.now() : null,
        lastError: sent
          ? null
          : "Delivery could not be confirmed. Check your inbox before retrying.",
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return { id, status: sent ? "sent" : "uncertain" };
  }
  private origin() {
    const raw = this.config.get<string>("OPS_FRONTEND_URL") ?? "";
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ServiceUnavailableException("Set OPS_FRONTEND_URL for report links.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (this.config.get("NODE_ENV") === "production" && url.protocol !== "https:")
    )
      throw new ServiceUnavailableException(
        "OPS_FRONTEND_URL must be an HTTPS origin in production.",
      );
    return url.origin;
  }
}
