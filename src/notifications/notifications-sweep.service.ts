import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { NotificationSeverity } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService, type SweepNotification } from "./notifications.service";

const DAY_MS = 86_400_000;
const TASK_DUE_WINDOW_DAYS = 3;
const CONTRACT_EXPIRY_WINDOW_DAYS = 30;
const TENDER_DEADLINE_WINDOW_DAYS = 5;

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function severityForDaysLeft(daysLeft: number, warnAt: number): NotificationSeverity {
  if (daysLeft < 0) return "critical";
  if (daysLeft <= warnAt) return "warning";
  return "info";
}

/**
 * Scans dated records across the app for conditions worth surfacing (deadline approaching,
 * overdue, expiring) and upserts a deduped Notification per recipient. Runs hourly — cheap
 * enough given the row counts here, and frequent enough that a newly-overdue item shows up
 * within the hour without needing a push mechanism.
 *
 * Deliberately in-app only: this is the sweep the CEO-dashboard review flagged as missing
 * ("nothing proactively tells anyone anything"). Email delivery is a later phase — this is
 * the data layer email would eventually read from.
 */
@Injectable()
export class NotificationsSweepService {
  private readonly logger = new Logger(NotificationsSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runSweep() {
    const now = new Date();
    const results = await Promise.allSettled([
      this.sweepTasksDue(now),
      this.sweepContractsExpiring(now),
      this.sweepInvoicesOverdue(now),
      this.sweepTenderDeadlines(now),
      this.sweepProjectsOverdue(now),
    ]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      this.logger.warn(`Notification sweep: ${failed.length}/5 scans failed`);
    }
  }

  private async sweepTasksDue(now: Date) {
    const windowEnd = new Date(now.getTime() + TASK_DUE_WINDOW_DAYS * DAY_MS);
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { not: "completed" },
        assigneeId: { not: null },
        dueDate: { lte: windowEnd },
      },
      select: { id: true, title: true, dueDate: true, assigneeId: true, projectId: true },
    });

    const entries: SweepNotification[] = [];
    for (const t of tasks) {
      if (!t.dueDate || !t.assigneeId) continue;
      const daysLeft = daysBetween(now, t.dueDate);
      const severity = severityForDaysLeft(daysLeft, TASK_DUE_WINDOW_DAYS);
      entries.push({
        userId: t.assigneeId,
        type: "task_due",
        severity,
        title:
          daysLeft < 0
            ? `Task overdue: ${t.title}`
            : `Task due ${this.relativeDay(daysLeft)}: ${t.title}`,
        body: t.dueDate.toISOString().slice(0, 10),
        resourceType: "task",
        resourceId: t.id,
        dedupeKey: `task_due:${t.id}`,
      });
    }
    await this.applyAndReconcile("task_due", entries);
  }

  private async sweepContractsExpiring(now: Date) {
    const windowEnd = new Date(now.getTime() + CONTRACT_EXPIRY_WINDOW_DAYS * DAY_MS);
    const contracts = await this.prisma.contract.findMany({
      where: { status: "active", endDate: { lte: windowEnd, not: null } },
      select: {
        id: true,
        contractNumber: true,
        title: true,
        endDate: true,
        autoRenew: true,
        accountManagerId: true,
        createdBy: true,
      },
    });

    const entries: SweepNotification[] = [];
    for (const c of contracts) {
      if (!c.endDate) continue;
      const recipient = c.accountManagerId ?? c.createdBy;
      if (!recipient) continue;
      const daysLeft = daysBetween(now, c.endDate);
      const severity = severityForDaysLeft(daysLeft, 7);
      const action = c.autoRenew ? "auto-renews" : "needs renewal";
      entries.push({
        userId: recipient,
        type: "contract_expiry",
        severity,
        title:
          daysLeft < 0
            ? `Contract expired: ${c.contractNumber} (${action})`
            : `Contract ${this.relativeDay(daysLeft)}, ${action}: ${c.contractNumber}`,
        body: c.title,
        resourceType: "contract",
        resourceId: c.id,
        dedupeKey: `contract_expiry:${c.id}`,
      });
    }
    await this.applyAndReconcile("contract_expiry", entries);
  }

  private async sweepInvoicesOverdue(now: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["paid", "void", "draft"] } },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        total: true,
        currencyCode: true,
        createdBy: true,
        contract: { select: { accountManagerId: true, createdBy: true } },
        client: { select: { accountManagerId: true } },
      },
    });

    const entries: SweepNotification[] = [];
    for (const inv of invoices) {
      // Most invoices here are billed directly against a client, not a contract — fall
      // through contract owner -> client's account manager -> whoever raised the invoice
      // rather than only recognizing the (rarer) contract-linked case.
      const recipient =
        inv.contract?.accountManagerId ??
        inv.contract?.createdBy ??
        inv.client?.accountManagerId ??
        inv.createdBy;
      if (!recipient) continue;
      const daysOverdue = daysBetween(inv.dueDate, now);
      entries.push({
        userId: recipient,
        type: "invoice_overdue",
        severity: daysOverdue > 14 ? "critical" : "warning",
        title: `Invoice ${inv.invoiceNumber} overdue by ${daysOverdue}d`,
        body: `${inv.currencyCode} ${Number(inv.total).toLocaleString()}`,
        resourceType: "invoice",
        resourceId: inv.id,
        dedupeKey: `invoice_overdue:${inv.id}`,
      });
    }
    await this.applyAndReconcile("invoice_overdue", entries);
  }

  private async sweepTenderDeadlines(now: Date) {
    const windowEnd = new Date(now.getTime() + TENDER_DEADLINE_WINDOW_DAYS * DAY_MS);
    const tenders = await this.prisma.tender.findMany({
      where: {
        stage: { notIn: ["won", "lost", "withdrawn", "cancelled"] },
        submissionDeadline: { lte: windowEnd, not: null },
      },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        submissionDeadline: true,
        accountManagerId: true,
        createdBy: true,
      },
    });

    const entries: SweepNotification[] = [];
    for (const t of tenders) {
      if (!t.submissionDeadline) continue;
      const recipient = t.accountManagerId ?? t.createdBy;
      if (!recipient) continue;
      const daysLeft = daysBetween(now, t.submissionDeadline);
      entries.push({
        userId: recipient,
        type: "tender_deadline",
        severity: severityForDaysLeft(daysLeft, TENDER_DEADLINE_WINDOW_DAYS),
        title:
          daysLeft < 0
            ? `Tender submission deadline passed: ${t.referenceNumber ?? t.title}`
            : `Tender submission due ${this.relativeDay(daysLeft)}: ${t.referenceNumber ?? t.title}`,
        body: t.title,
        resourceType: "tender",
        resourceId: t.id,
        dedupeKey: `tender_deadline:${t.id}`,
      });
    }
    await this.applyAndReconcile("tender_deadline", entries);
  }

  private async sweepProjectsOverdue(now: Date) {
    const projects = await this.prisma.project.findMany({
      where: {
        status: { notIn: ["completed", "cancelled"] },
        endDate: { lt: now, not: null },
        // Ongoing/retainer work has no natural end — never "overdue" the way a bounded
        // delivery is (see Project.engagementType).
        engagementType: { not: "ongoing" },
      },
      select: { id: true, name: true, endDate: true, createdBy: true },
    });

    const entries: SweepNotification[] = [];
    for (const p of projects) {
      if (!p.endDate || !p.createdBy) continue;
      const daysOverdue = daysBetween(p.endDate, now);
      entries.push({
        userId: p.createdBy,
        type: "project_alert",
        severity: "critical",
        title: `Project past its end date by ${daysOverdue}d: ${p.name}`,
        resourceType: "project",
        resourceId: p.id,
        dedupeKey: `project_alert:${p.id}`,
      });
    }
    await this.applyAndReconcile("project_alert", entries);
  }

  private relativeDay(daysLeft: number): string {
    if (daysLeft === 0) return "today";
    if (daysLeft === 1) return "tomorrow";
    return `in ${daysLeft}d`;
  }

  // Upserts every currently-true condition, then clears any unread notification for this
  // sweep type whose dedupeKey is no longer among the entries just computed (the underlying
  // task/contract/invoice/tender/project resolved since the last run). The valid-keys set
  // comes from `entries` itself rather than a separately re-filtered query — entries already
  // only contains rows that passed every condition including having a resolvable recipient,
  // so there's exactly one place that logic has to be right.
  private async applyAndReconcile(type: string, entries: SweepNotification[]) {
    for (const entry of entries) {
      await this.notifications.upsertSwept(entry);
    }
    const stillValidKeys = entries.map((e) => e.dedupeKey);
    const stale = await this.prisma.notification.findMany({
      where: {
        dedupeKey: { startsWith: `${type}:` },
        isRead: false,
        NOT: { dedupeKey: { in: stillValidKeys } },
      },
      select: { userId: true, dedupeKey: true },
    });
    for (const s of stale) {
      if (!s.dedupeKey) continue;
      await this.notifications.clearIfUnread(s.userId, s.dedupeKey);
    }
  }
}
