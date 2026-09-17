import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { maskUserRef } from "../common/mask-user-ref";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { REPORT_EMAIL_DEFAULTS, REPORT_EMAIL_KEYS, type ReportEmailKey } from "./report-email.util";

const USER_REF = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;

// Finance snapshots store KPI tiles as { label, value } entries.
function financeFigures(snapshot: unknown): { label: string; value: string }[] {
  const kpis = (
    snapshot as { kpis?: { label?: unknown; value?: unknown; format?: unknown }[] } | null
  )?.kpis;
  if (!Array.isArray(kpis)) return [];
  return kpis
    .filter((k) => k && typeof k.label === "string")
    .map((k) => {
      const n = Number(k.value);
      const value = Number.isNaN(n)
        ? String(k.value ?? "")
        : k.format === "currency"
          ? `KES ${Math.round(n).toLocaleString("en-KE")}`
          : k.format === "percent"
            ? `${n.toFixed(1)}%`
            : n.toLocaleString("en-KE");
      return { label: String(k.label), value };
    });
}

export interface InboxItem {
  kind: "department_report" | "finance_report";
  id: string;
  title: string;
  department: { id: string | null; name: string; code: string };
  periodStart: Date;
  periodEnd: Date;
  status: string;
  resubmitted: boolean;
  submittedAt: Date | null;
  updatedAt: Date;
  author: { id: string; fullName: string | null; email: string } | null;
  lastMessage: { body: string; kind: string; createdAt: Date; authorName: string | null } | null;
  figures: { label: string; value: string }[];
  summary: string | null;
}

@Injectable()
export class ReportsInboxService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every report submitted to the CEO, from all departments, newest activity first. */
  async inbox(user: AuthenticatedUser): Promise<InboxItem[]> {
    if (!isAdminOrCeo(user)) throw new ForbiddenException("Only the CEO has a reports inbox");
    const finance = await this.prisma.department.findUnique({ where: { code: "finance" } });
    const [deptReports, financeReports] = await Promise.all([
      this.prisma.departmentReport.findMany({
        where: { NOT: { status: "draft" } },
        include: {
          department: { select: { id: true, name: true, code: true } },
          creator: { select: USER_REF },
          messages: { orderBy: { createdAt: "desc" }, include: { author: { select: USER_REF } } },
        },
      }),
      this.prisma.financeReport.findMany({
        where: { NOT: { status: "draft" } },
        include: {
          creator: { select: USER_REF },
          comments: { orderBy: { createdAt: "desc" }, include: { author: { select: USER_REF } } },
        },
      }),
    ]);

    const items: InboxItem[] = [
      ...deptReports.map((r) => {
        const last = r.messages[0];
        return {
          kind: "department_report" as const,
          id: r.id,
          title: r.title,
          department: r.department,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          status: r.status,
          resubmitted: r.status === "submitted" && r.messages.some((m) => m.kind === "resubmitted"),
          submittedAt: r.submittedAt,
          updatedAt: last?.createdAt ?? r.updatedAt,
          author: maskUserRef(r.creator, user),
          lastMessage: last
            ? {
                body: last.body,
                kind: last.kind,
                createdAt: last.createdAt,
                authorName: maskUserRef(last.author, user).fullName,
              }
            : null,
          figures: r.figures as { label: string; value: string }[],
          summary: r.summary,
        };
      }),
      ...financeReports.map((r) => {
        const last = r.comments[0];
        return {
          kind: "finance_report" as const,
          id: r.id,
          title: r.title,
          department: {
            id: finance?.id ?? null,
            name: finance?.name ?? "Finance",
            code: "finance",
          },
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          status: r.status,
          resubmitted: r.status === "submitted" && r.comments.some((c) => c.kind === "resubmitted"),
          submittedAt: r.submittedAt,
          updatedAt: last?.createdAt ?? r.updatedAt,
          author: maskUserRef(r.creator, user),
          lastMessage: last
            ? {
                body: last.body,
                kind: last.kind,
                createdAt: last.createdAt,
                authorName: maskUserRef(last.author, user).fullName,
              }
            : null,
          figures: financeFigures(r.snapshot),
          summary: r.narrative,
        };
      }),
    ];
    return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async emailSubscriptions(user: AuthenticatedUser) {
    const rows = await this.prisma.reportEmailSubscription.findMany({ where: { userId: user.id } });
    return REPORT_EMAIL_KEYS.map((key) => ({
      reportKey: key,
      enabled: rows.find((r) => r.reportKey === key)?.enabled ?? REPORT_EMAIL_DEFAULTS[key],
    }));
  }

  async setEmailSubscription(user: AuthenticatedUser, reportKey: string, enabled: boolean) {
    if (!REPORT_EMAIL_KEYS.includes(reportKey as ReportEmailKey))
      throw new BadRequestException("Unknown report email");
    await this.prisma.reportEmailSubscription.upsert({
      where: { userId_reportKey: { userId: user.id, reportKey } },
      create: { userId: user.id, reportKey, enabled },
      update: { enabled },
    });
    return this.emailSubscriptions(user);
  }
}
