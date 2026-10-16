import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentLedgerAccessService } from "./payment-ledger-access.service";
import { PaymentGatewayService } from "./payment-gateway.service";

const filterSchema = z
  .object({
    q: z.string().max(255).optional(),
    system: z.string().max(100).optional(),
    paybill: z.string().max(32).optional(),
    destination: z.enum(["water", "external", "unallocated"]).optional(),
    channel: z.enum(["c2b", "stk", "b2c", "manual"]).optional(),
    status: z.enum(["unallocated", "pending", "succeeded", "failed"]).optional(),
    paymentStatus: z.enum(["pending", "succeeded", "failed", "refunded"]).optional(),
    direction: z.enum(["in", "out"]).optional(),
    review: z.enum(["true", "false"]).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (f) => !f.from || !f.to || f.from <= f.to,
    "The end date must be on or after the start date.",
  );
const rowSelect = {
  id: true,
  receipt: true,
  paybill: true,
  reference: true,
  amount: true,
  currency: true,
  direction: true,
  channel: true,
  paymentStatus: true,
  processingStatus: true,
  destination: true,
  systemName: true,
  applicationCode: true,
  payerName: true,
  requiresReview: true,
  transactionAt: true,
  receivedAt: true,
  syncedAt: true,
} as const;

export function ledgerFilters(query: Record<string, unknown>) {
  const parsed = filterSchema.safeParse(
    Object.fromEntries(Object.entries(query).filter(([, value]) => value !== "")),
  );
  if (!parsed.success)
    throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
  const f = parsed.data;
  const where: Prisma.PaymentLedgerEntryWhereInput = {};
  if (f.q)
    where.OR = ["receipt", "reference", "payerName", "payerPhone", "systemName"].map((key) => ({
      [key]: { contains: f.q },
    }));
  for (const [key, value] of Object.entries({
    systemName: f.system,
    paybill: f.paybill,
    destination: f.destination,
    channel: f.channel,
    processingStatus: f.status,
    paymentStatus: f.paymentStatus,
    direction: f.direction,
  }))
    if (value) Object.assign(where, { [key]: value });
  if (f.review) where.requiresReview = f.review === "true";
  if (f.from || f.to)
    where.receivedAt = {
      ...(f.from && { gte: new Date(`${f.from}T00:00:00+03:00`) }),
      ...(f.to && {
        lt: new Date(new Date(`${f.to}T00:00:00+03:00`).getTime() + 86400000),
      }),
    };
  return { where, page: f.page, pageSize: f.pageSize };
}

function csvCell(value: unknown) {
  let text =
    value instanceof Date
      ? value.toISOString()
      : value === null || value === undefined
        ? ""
        : String(value);
  if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class PaymentLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PaymentLedgerAccessService,
    private readonly gateway: PaymentGatewayService,
  ) {}

  async list(user: AuthenticatedUser, query: Record<string, unknown>) {
    await this.access.assert(user);
    const { where, page, pageSize } = ledgerFilters(query);
    const [data, total] = await Promise.all([
      this.prisma.paymentLedgerEntry.findMany({
        where,
        select: rowSelect,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.paymentLedgerEntry.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async summary(user: AuthenticatedUser, query: Record<string, unknown>) {
    await this.access.assert(user);
    const { where } = ledgerFilters(query);
    const [count, unallocated, requiresReview, failedProcessing, totals, systems, systemNames] =
      await Promise.all([
        this.prisma.paymentLedgerEntry.count({ where }),
        this.prisma.paymentLedgerEntry.count({
          where: { AND: [where, { destination: "unallocated" }] },
        }),
        this.prisma.paymentLedgerEntry.count({
          where: { AND: [where, { requiresReview: true }] },
        }),
        this.prisma.paymentLedgerEntry.count({
          where: { AND: [where, { processingStatus: "failed" }] },
        }),
        this.prisma.paymentLedgerEntry.groupBy({
          by: ["currency", "direction"],
          where: {
            AND: [where, { paymentStatus: "succeeded", amount: { not: null } }],
          },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.paymentLedgerEntry.groupBy({
          by: ["systemName", "currency", "direction", "paymentStatus"],
          where,
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.paymentLedgerEntry.findMany({
          distinct: ["systemName"],
          select: { systemName: true },
          orderBy: { systemName: "asc" },
        }),
      ]);
    return {
      count,
      unallocated,
      requiresReview,
      failedProcessing,
      totals,
      systems,
      systemNames: systemNames.map((s) => s.systemName),
    };
  }

  async detail(user: AuthenticatedUser, id: string) {
    await this.access.assert(user);
    const row = await this.prisma.paymentLedgerEntry.findUniqueOrThrow({
      where: { id },
      select: { snapshot: true, syncedAt: true },
    });
    return { ...(row.snapshot as Prisma.JsonObject), syncedAt: row.syncedAt };
  }

  async csv(user: AuthenticatedUser, query: Record<string, unknown>) {
    await this.access.assert(user);
    const { where } = ledgerFilters(query);
    const fields = [
      "receipt",
      "paybill",
      "reference",
      "amount",
      "currency",
      "direction",
      "channel",
      "paymentStatus",
      "processingStatus",
      "destination",
      "systemName",
      "payerName",
      "payerPhone",
      "transactionAt",
      "receivedAt",
      "requiresReview",
      "syncedAt",
    ] as const;
    const lines = [fields.map(csvCell).join(",")];
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.paymentLedgerEntry.findMany({
        where,
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      for (const row of rows) lines.push(fields.map((field) => csvCell(row[field])).join(","));
      if (rows.length < 500) break;
      cursor = rows[rows.length - 1].id;
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  async bridge(
    user: AuthenticatedUser,
    path: string,
    method = "GET",
    data?: Record<string, unknown>,
  ) {
    await this.access.assert(user, "write");
    if (method === "GET") return this.gateway.request(path);
    const actor = { id: user.id, email: user.email };
    const audit = await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "payment_ledger_action_requested",
        entityType: "payment-ledger",
        metadata: { path, method },
      },
    });
    const result = await this.gateway.request(path, method, { data, actor });
    await this.prisma.auditLog.update({
      where: { id: audit.id },
      data: { action: "payment_ledger_action_completed" },
    });
    return result;
  }
}
