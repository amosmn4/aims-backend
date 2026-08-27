import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationSeverity, NotificationType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateReminderDto } from "./dto/create-reminder.dto";
import type { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";

const DEFAULT_PREFERENCES = {
  taskUpdates: true,
  projectUpdates: true,
  financeAlerts: true,
  tenderAlerts: true,
  remindersMeetings: true,
  emailDigest: true,
};

export interface SweepNotification {
  userId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  resourceType: string;
  resourceId: string;
  dedupeKey: string;
}

// The six toggles on NotificationPreference — broader than one-per-NotificationType so the
// settings page stays a short, scannable list. document_shared folds into projectUpdates
// ("shared with you") rather than getting its own category.
type NotificationCategory =
  "taskUpdates" | "projectUpdates" | "financeAlerts" | "tenderAlerts" | "remindersMeetings";

const CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory> = {
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
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  findForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Notification not found");
    if (existing.userId !== user.id) throw new ForbiddenException("Not your notification");
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(user: AuthenticatedUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  }

  async dismiss(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Notification not found");
    if (existing.userId !== user.id) throw new ForbiddenException("Not your notification");
    await this.prisma.notification.delete({ where: { id } });
    return { success: true };
  }

  // Manual, immediate notifications (meetings/reminders) — a person logging a reminder for
  // themselves or flagging something for a colleague. Unlike sweep-generated rows these never
  // dedupe (dedupeKey stays null) since each one is a distinct human action, not a recurring
  // condition check.
  async createReminder(dto: CreateReminderDto, user: AuthenticatedUser) {
    return this.prisma.notification.create({
      data: {
        userId: dto.userId ?? user.id,
        type: dto.type,
        severity: "info",
        title: dto.title,
        body: dto.body,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        createdBy: user.id,
      },
    });
  }

  // Idempotent upsert used by the sweep: creates the notification if it doesn't exist yet for
  // this (userId, dedupeKey) pair, refreshes its content if it does — but never flips isRead
  // back to false, so a notification the user already dismissed stays dismissed even though
  // the underlying condition (e.g. a contract still nearing expiry) is still true.
  async upsertSwept(n: SweepNotification) {
    const data: Prisma.NotificationUpdateInput = {
      title: n.title,
      body: n.body,
      severity: n.severity,
    };
    await this.prisma.notification.upsert({
      where: { userId_dedupeKey: { userId: n.userId, dedupeKey: n.dedupeKey } },
      create: {
        userId: n.userId,
        type: n.type,
        severity: n.severity,
        title: n.title,
        body: n.body,
        resourceType: n.resourceType,
        resourceId: n.resourceId,
        dedupeKey: n.dedupeKey,
      },
      update: data,
    });
  }

  // Sweep-generated notifications become moot once their condition resolves (task completed,
  // invoice paid, contract renewed) — clear any *unread* one still open for that dedupe key so
  // stale alerts don't linger. Read ones are left as a historical record.
  async clearIfUnread(userId: string, dedupeKey: string) {
    await this.prisma.notification.deleteMany({ where: { userId, dedupeKey, isRead: false } });
  }

  // The single entry point every business-event trigger (task assigned, added to a project,
  // commented on, document shared with you, client request assigned) calls — checks the
  // recipient's preference for this notification's category first, so old and new call sites
  // alike respect it uniformly. A plain create, not upsertSwept's condition-upsert semantics:
  // each of these is a distinct one-time event (like createReminder), not a recurring condition
  // the hourly sweep re-evaluates.
  async notify(params: {
    userId: string;
    type: NotificationType;
    severity?: NotificationSeverity;
    title: string;
    body?: string;
    resourceType?: string;
    resourceId?: string;
    createdBy?: string;
  }) {
    const category = CATEGORY_BY_TYPE[params.type];
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId: params.userId },
    });
    // No row yet = every category defaults to on — only an explicit `false` skips.
    if (pref && pref[category] === false) return;

    await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        severity: params.severity ?? "info",
        title: params.title,
        body: params.body,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        createdBy: params.createdBy,
      },
    });
  }

  // No row yet = every category defaults on, matching `notify()`'s own fallback — a user who's
  // never opened the settings page sees the same "everything on" state the backend assumes.
  async getPreferences(userId: string) {
    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return pref ?? { userId, ...DEFAULT_PREFERENCES, updatedAt: null };
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_PREFERENCES, ...dto },
      update: dto,
    });
  }
}
