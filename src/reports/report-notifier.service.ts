import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../notifications/email/email.service";
import { parseCorsOrigins } from "../config/env.validation";
import { escapeHtml } from "./report-email.util";
import { NotificationChannelsService } from "../notifications/channels/notification-channels.service";

export type ReportResource = "department_report" | "finance_report";

interface ReportEvent {
  type: NotificationType;
  title: string;
  body?: string;
  resourceType: ReportResource;
  resourceId: string;
  actorId: string;
}

@Injectable()
export class ReportNotifierService {
  private readonly logger = new Logger(ReportNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly channels: NotificationChannelsService,
    private readonly config: ConfigService,
  ) {}

  ceoUserIds() {
    return this.prisma.user
      .findMany({
        where: { isActive: true, roles: { some: { role: "ceo" } } },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));
  }

  /** In-app notification for each recipient except the actor. */
  async notify(userIds: (string | null | undefined)[], event: ReportEvent) {
    const recipients = [
      ...new Set(userIds.filter((id): id is string => !!id && id !== event.actorId)),
    ];
    await Promise.all(
      recipients.map((userId) =>
        this.notifications
          .notify({
            userId,
            type: event.type,
            title: event.title,
            body: event.body,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            createdBy: event.actorId,
          })
          .catch((err) => this.logger.warn(`Report notification failed: ${err}`)),
      ),
    );
    return recipients;
  }

  /** Notifies every CEO, and emails those subscribed to report submissions. */
  async toCeo(event: ReportEvent, emailSubject?: string) {
    const recipients = await this.notify(await this.ceoUserIds(), event);
    if (!emailSubject || recipients.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: recipients } },
      select: {
        id: true,
        email: true,
        fullName: true,
        reportEmailSubscriptions: { where: { reportKey: "report_submitted" } },
      },
    });
    const link = this.link(event.resourceType, event.resourceId);
    for (const u of users) {
      const sub = u.reportEmailSubscriptions[0];
      if (sub && !sub.enabled) continue;
      if (!(await this.channels.allowsEvent(u.id, event.type))) continue;
      if (await this.channels.emailsEvent(u.id, event.type)) continue;
      await this.email.send(
        u.email,
        emailSubject,
        `<p>Hello ${escapeHtml(u.fullName ?? "")},</p><p>${escapeHtml(event.title)}</p>${
          event.body ? `<p>${escapeHtml(event.body)}</p>` : ""
        }<p><a href="${link}">Open the report in AIMS</a></p>`,
      );
    }
  }

  link(resourceType: ReportResource, id: string) {
    const base = parseCorsOrigins(this.config.get<string>("CORS_ORIGIN"))[0] ?? "";
    return resourceType === "finance_report"
      ? `${base}/finance/reports/${id}`
      : `${base}/department-reports/${id}`;
  }
}
