import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { maskUserRef } from "../common/mask-user-ref";
import { isSystemAdmin } from "../common/is-system-admin";
import { maybePaginate, type PaginationQueryDto } from "../common/pagination";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { NOISE_AREAS, areaLabel, recordName, summarize } from "./audit-describe";

export interface AuditLogEntry {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface AuditFilters {
  userId?: string;
  area?: string;
  from?: string;
  to?: string;
  q?: string;
}

const EXPORT_LIMIT = 5000;
const USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;

type Row = {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
  newValue: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  user: { id: string; fullName: string | null; email: string; roles: { role: string }[] } | null;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    viewer: AuthenticatedUser,
    filters: AuditFilters = {},
    pagination: PaginationQueryDto = {},
  ) {
    const result = await maybePaginate(
      this.prisma.auditLog,
      {
        where: await this.filteredWhere(viewer, filters),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          newValue: true,
          metadata: true,
          user: { select: USER_SELECT },
        },
      },
      pagination,
    );
    const rows = (Array.isArray(result) ? result : result.data) as unknown as Row[];
    const data = await this.present(rows, viewer);
    return Array.isArray(result) ? data : { ...result, data };
  }

  /** Rows for the Excel export, newest first, capped so a download stays quick. */
  async exportRows(viewer: AuthenticatedUser, filters: AuditFilters) {
    const rows = (await this.prisma.auditLog.findMany({
      where: await this.filteredWhere(viewer, filters),
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      select: {
        id: true,
        userId: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        newValue: true,
        metadata: true,
        user: { select: USER_SELECT },
      },
    })) as unknown as Row[];
    const presented = await this.present(rows, viewer);
    return {
      limited: rows.length === EXPORT_LIMIT,
      rows: presented.map((r) => ({
        when: r.createdAt,
        who: r.user ? r.user.fullName || r.user.email : "AIMS",
        what: r.summary,
        area: r.area,
        record: r.recordName ?? "",
      })),
    };
  }

  /** The people and areas that appear in the log, for the filter menus. */
  async filterOptions(viewer: AuthenticatedUser) {
    const where = await this.visibleWhere(viewer);
    const [areas, actors] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ["entityType"], where, orderBy: { entityType: "asc" } }),
      this.prisma.auditLog.groupBy({
        by: ["userId"],
        where: { AND: [where, { userId: { not: null } }] },
      }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: actors.map((a) => a.userId).filter((id): id is string => !!id) } },
      select: USER_SELECT,
      orderBy: { fullName: "asc" },
    });
    return {
      areas: areas
        .filter((a) => isSystemAdmin(viewer) || !NOISE_AREAS.includes(a.entityType))
        .map((a) => ({ value: a.entityType, label: areaLabel(a.entityType) })),
      people: users.map((u) => {
        const masked = maskUserRef(u, viewer);
        return { id: u.id, name: masked.fullName || masked.email };
      }),
    };
  }

  private async present(rows: Row[], viewer: AuthenticatedUser) {
    const names = await this.fallbackNames(rows);
    const admin = isSystemAdmin(viewer);
    return rows.map(({ newValue, metadata, ...row }) => {
      const user = row.user ? maskUserRef(row.user, viewer) : null;
      const actor = user ? user.fullName || user.email : "AIMS";
      const name =
        recordName(newValue) ?? (row.entityId ? (names.get(row.entityId) ?? null) : null);
      return {
        ...row,
        user,
        area: areaLabel(row.entityType),
        recordName: name,
        summary: summarize(actor, row.action, name),
        ...(admin && { newValue, metadata }),
      };
    });
  }

  // Deletes and sub-actions often return no name, so borrow one from an earlier entry for the same record.
  private async fallbackNames(rows: Row[]) {
    const missing = [
      ...new Set(rows.filter((r) => !recordName(r.newValue) && r.entityId).map((r) => r.entityId!)),
    ];
    const names = new Map<string, string>();
    if (missing.length === 0) return names;
    const earlier = await this.prisma.auditLog.findMany({
      where: { entityId: { in: missing } },
      select: { entityId: true, newValue: true },
      orderBy: { createdAt: "desc" },
    });
    for (const e of earlier) {
      const name = recordName(e.newValue);
      if (e.entityId && name && !names.has(e.entityId)) names.set(e.entityId, name);
    }
    return names;
  }

  private async filteredWhere(
    viewer: AuthenticatedUser,
    f: AuditFilters,
  ): Promise<Prisma.AuditLogWhereInput> {
    const and: Prisma.AuditLogWhereInput[] = [await this.visibleWhere(viewer)];
    if (f.userId) and.push({ userId: f.userId });
    if (f.area) and.push({ entityType: f.area });
    else if (!isSystemAdmin(viewer)) and.push({ entityType: { notIn: NOISE_AREAS } });
    const from = f.from ? new Date(f.from) : null;
    const to = f.to ? new Date(f.to) : null;
    if (from && !Number.isNaN(from.getTime())) and.push({ createdAt: { gte: from } });
    if (to && !Number.isNaN(to.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.to!)) to.setUTCHours(23, 59, 59, 999);
      and.push({ createdAt: { lte: to } });
    }
    const q = f.q?.trim();
    if (q) {
      and.push({
        OR: [
          { user: { fullName: { contains: q } } },
          { entityType: { contains: q.replace(/\s+/g, "_") } },
          { newValue: { path: "$.name", string_contains: q } },
          { newValue: { path: "$.title", string_contains: q } },
          { newValue: { path: "$.invoiceNumber", string_contains: q } },
          { newValue: { path: "$.referenceNumber", string_contains: q } },
        ],
      });
    }
    return { AND: and };
  }

  private async visibleWhere(viewer: AuthenticatedUser): Promise<Prisma.AuditLogWhereInput> {
    const root = await this.prisma.user.findFirst({
      where: { roles: { some: { role: "system_admin" } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (isSystemAdmin(viewer)) {
      return root && root.id !== viewer.id ? { userId: { not: root.id } } : {};
    }
    const restricted = await this.prisma.user.findMany({
      where: { roles: { some: { role: "system_admin" } } },
      select: { id: true },
    });
    const ids = restricted.map((u) => u.id);
    if (ids.length === 0) return {};
    return {
      AND: [
        { OR: [{ userId: null }, { userId: { notIn: ids } }] },
        { NOT: { entityType: "users", entityId: { in: ids } } },
      ],
    };
  }

  create(entry: AuditLogEntry) {
    return this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? undefined,
        oldValue: entry.oldValue ?? undefined,
        newValue: entry.newValue ?? undefined,
        metadata: entry.metadata ?? undefined,
      },
    });
  }
}
