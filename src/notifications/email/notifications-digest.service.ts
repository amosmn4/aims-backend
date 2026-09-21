import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService } from "./email.service";
import { EVENT_KEY_BY_TYPE } from "../channels/notification-channels.service";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DigestItem {
  title: string;
  body: string | null;
}

function renderDigest(name: string, items: DigestItem[]): string {
  const rows = items
    .map(
      (i) =>
        `<li><strong>${escapeHtml(i.title)}</strong>${i.body ? ` — ${escapeHtml(i.body)}` : ""}</li>`,
    )
    .join("");
  return `<p>Hi ${escapeHtml(name)},</p><p>Here's what's waiting for you in AIMS:</p><ul>${rows}</ul>`;
}

// Compiles each user's unread notifications (same table NotificationsSweepService already
// populates) into one daily digest email — the delivery layer that never existed on top of
// the existing in-app notification sweep.
@Injectable()
export class NotificationsDigestService {
  private readonly logger = new Logger(NotificationsDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async runDigest() {
    if (!this.email.isConfigured()) {
      return { configured: false, sent: 0 };
    }

    const unread = await this.prisma.notification.findMany({
      where: { isRead: false },
      include: { user: { select: { email: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Opted out of the digest specifically — they may still want in-app notifications, this
    // only silences the daily email.
    const optedOut = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: [...new Set(unread.map((n) => n.userId))] }, emailDigest: false },
      select: { userId: true },
    });
    const optedOutIds = new Set(optedOut.map((p) => p.userId));

    // Anything the person switched off or muted stays out of the daily email too.
    const userIds = [...new Set(unread.map((n) => n.userId))];
    const channelPrefs = await this.prisma.notificationChannelPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, eventKey: true, inApp: true, mutedUntil: true },
    });
    const now = new Date();
    const silenced = new Set(
      channelPrefs
        .filter((p) => !p.inApp || (p.mutedUntil && p.mutedUntil.getTime() > now.getTime()))
        .map((p) => `${p.userId}:${p.eventKey}`),
    );

    const byUser = new Map<string, { email: string; name: string; items: DigestItem[] }>();
    for (const n of unread) {
      if (!n.user?.email || optedOutIds.has(n.userId)) continue;
      if (silenced.has(`${n.userId}:${EVENT_KEY_BY_TYPE[n.type]}`)) continue;
      const entry = byUser.get(n.userId) ?? {
        email: n.user.email,
        name: n.user.fullName ?? n.user.email,
        items: [],
      };
      entry.items.push({ title: n.title, body: n.body });
      byUser.set(n.userId, entry);
    }

    let sent = 0;
    for (const { email, name, items } of byUser.values()) {
      const subject = `AIMS — ${items.length} update${items.length === 1 ? "" : "s"} waiting for you`;
      const ok = await this.email.send(email, subject, renderDigest(name, items));
      if (ok) sent += 1;
    }

    if (sent < byUser.size) {
      this.logger.warn(`Digest: sent ${sent}/${byUser.size} emails`);
    }
    return { configured: true, sent, recipients: byUser.size };
  }
}
