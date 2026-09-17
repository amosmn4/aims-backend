import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NotificationType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { parseCorsOrigins } from "../../config/env.validation";
import { MessagingService } from "./messaging.service";

export const CHANNEL_EVENTS = [
  { key: "taskUpdates", label: "Tasks and client requests given to me" },
  { key: "projectUpdates", label: "Project alerts and things shared with me" },
  { key: "financeAlerts", label: "Overdue invoices and contracts ending" },
  { key: "tenderAlerts", label: "Tender deadlines" },
  { key: "remindersMeetings", label: "Meetings and reminders" },
  { key: "reports", label: "Department reports" },
] as const;
export type ChannelEventKey = (typeof CHANNEL_EVENTS)[number]["key"];

export const EVENT_KEY_BY_TYPE: Record<NotificationType, ChannelEventKey> = {
  task_due: "taskUpdates",
  task_assigned: "taskUpdates",
  task_comment: "taskUpdates",
  client_request_assigned: "taskUpdates",
  project_alert: "projectUpdates",
  project_shared: "projectUpdates",
  document_shared: "projectUpdates",
  contract_expiry: "financeAlerts",
  invoice_overdue: "financeAlerts",
  tender_deadline: "tenderAlerts",
  meeting: "remindersMeetings",
  reminder: "remindersMeetings",
  report_submitted: "reports",
  report_reviewed: "reports",
  report_comment: "reports",
  report_due: "reports",
  comment_reply: "taskUpdates",
  ticket_update: "taskUpdates",
};

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

@Injectable()
export class NotificationChannelsService {
  private readonly logger = new Logger(NotificationChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  async forUser(userId: string) {
    const [rows, user] = await Promise.all([
      this.prisma.notificationChannelPreference.findMany({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    ]);
    const byKey = new Map(rows.map((r) => [r.eventKey, r]));
    return {
      events: CHANNEL_EVENTS,
      available: {
        email: this.email.isConfigured(),
        sms: this.messaging.smsConfigured(),
        whatsapp: this.messaging.whatsappConfigured(),
      },
      hasPhone: !!user?.phone,
      preferences: Object.fromEntries(
        CHANNEL_EVENTS.map((e) => {
          const r = byKey.get(e.key);
          return [
            e.key,
            { email: r?.email ?? false, sms: r?.sms ?? false, whatsapp: r?.whatsapp ?? false },
          ];
        }),
      ),
    };
  }

  async setForUser(
    userId: string,
    dto: { eventKey: string; email?: boolean; sms?: boolean; whatsapp?: boolean },
  ) {
    const eventKey = CHANNEL_EVENTS.find((e) => e.key === dto.eventKey)?.key;
    if (!eventKey) throw new BadRequestException("Choose a type of alert");
    const data = { email: dto.email, sms: dto.sms, whatsapp: dto.whatsapp };
    await this.prisma.notificationChannelPreference.upsert({
      where: { userId_eventKey: { userId, eventKey } },
      create: { userId, eventKey, email: !!dto.email, sms: !!dto.sms, whatsapp: !!dto.whatsapp },
      update: data,
    });
    return this.forUser(userId);
  }

  /** Sends the alert on each extra channel the person switched on; never throws. */
  async deliver(userId: string, type: NotificationType, title: string, body?: string | null) {
    try {
      const pref = await this.prisma.notificationChannelPreference.findUnique({
        where: { userId_eventKey: { userId, eventKey: EVENT_KEY_BY_TYPE[type] } },
        include: { user: { select: { email: true, phone: true, fullName: true, isActive: true } } },
      });
      if (!pref || !pref.user.isActive) return;
      const link = parseCorsOrigins(this.config.get<string>("CORS_ORIGIN"))[0] ?? "";
      const text = `AIMS: ${title}${body ? ` — ${body}` : ""}`;
      const jobs: Promise<boolean>[] = [];
      if (pref.email) {
        jobs.push(
          this.email.send(
            pref.user.email,
            title,
            `<p>Hello ${escapeHtml(pref.user.fullName ?? "")},</p><p><strong>${escapeHtml(title)}</strong></p>${
              body ? `<p>${escapeHtml(body)}</p>` : ""
            }<p><a href="${link}">Open AIMS</a></p>`,
          ),
        );
      }
      if (pref.sms && pref.user.phone) jobs.push(this.messaging.sendSms(pref.user.phone, text));
      if (pref.whatsapp && pref.user.phone)
        jobs.push(this.messaging.sendWhatsApp(pref.user.phone, text));
      await Promise.all(jobs);
    } catch (err) {
      this.logger.warn(`Alert delivery failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Sends a test SMS to the person's own phone so they know SMS alerts reach them. */
  async testSms(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user?.phone) {
      throw new BadRequestException("Add your phone number in My profile first");
    }
    const result = await this.messaging.sendSmsDetailed(
      user.phone,
      "AIMS: this is a test. SMS alerts will reach you on this number.",
    );
    if (!result.sent) throw new BadRequestException(result.reason ?? "The test SMS wasn't sent");
    return { sent: true };
  }

  /** Whether the person already gets this alert type by email through their channel settings. */
  async emailsEvent(userId: string, type: NotificationType) {
    const pref = await this.prisma.notificationChannelPreference.findUnique({
      where: { userId_eventKey: { userId, eventKey: EVENT_KEY_BY_TYPE[type] } },
      select: { email: true },
    });
    return !!pref?.email;
  }
}
