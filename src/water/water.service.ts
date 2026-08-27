import { BadRequestException, Injectable } from "@nestjs/common";
import type { WaterMeterType, WaterVendingSystem } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../common/pagination";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateZoneDto } from "./dto/create-zone.dto";
import type { UpdateZoneDto } from "./dto/update-zone.dto";
import type { CreateCustomerDto } from "./dto/create-customer.dto";
import type { UpdateCustomerDto } from "./dto/update-customer.dto";
import type { CreateMeterDto } from "./dto/create-meter.dto";
import type { UpdateMeterDto } from "./dto/update-meter.dto";
import type { CreateReadingDto } from "./dto/create-reading.dto";
import type { UpdateReadingDto } from "./dto/update-reading.dto";
import type { CreateUsageUploadDto } from "./dto/create-usage-upload.dto";

function monthRange(month?: string): { start: Date; end: Date } {
  const now = new Date();
  const [y, m] = month
    ? month.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

function shiftMonth(month: string | undefined, delta: number): string {
  const { start } = monthRange(month);
  start.setUTCMonth(start.getUTCMonth() + delta);
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Bucket-key helpers for readingSeries — each maps a reading's timestamp to the label its
// delta-usage should be grouped under.
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekKey(d: Date): string {
  // Monday of the reading's week, as a date string — ISO-style week bucketing without pulling in
  // a date library for just this.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

@Injectable()
export class WaterService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------- Zones (self-nesting — a zone can sit inside another zone) ---------- */

  listZones(pagination: PaginationQueryDto = {}) {
    return maybePaginate(
      this.prisma.waterZone,
      {
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { children: true, meters: true, customers: true } },
        },
        orderBy: { name: "asc" },
      },
      pagination,
    );
  }

  // Every zone, unpaginated — used to build the Zone / Sub-zone cascading pickers on the
  // Meter/Customer forms and the parent-zone picker on this page itself, where the full tree
  // needs to be in memory at once rather than sliced across pages.
  listAllZones() {
    return this.prisma.waterZone.findMany({
      select: { id: true, name: true, parentZoneId: true },
      orderBy: { name: "asc" },
    });
  }

  createZone(dto: CreateZoneDto) {
    return this.prisma.waterZone.create({
      data: { name: dto.name, parentZoneId: dto.parentZoneId },
    });
  }

  async updateZone(id: string, dto: UpdateZoneDto) {
    await this.prisma.waterZone.findUniqueOrThrow({ where: { id } });
    if (dto.parentZoneId) {
      if (dto.parentZoneId === id) {
        throw new BadRequestException("A zone can't be its own parent");
      }
      if (await this.isDescendant(dto.parentZoneId, id)) {
        throw new BadRequestException("A zone can't be moved inside one of its own sub-zones");
      }
    }
    return this.prisma.waterZone.update({
      where: { id },
      data: { name: dto.name, parentZoneId: dto.parentZoneId },
    });
  }

  // True when `candidateId` is `ancestorId` itself or nested somewhere under it — walks up from
  // `candidateId` through parents rather than down from `ancestorId` through children, since the
  // tree can be arbitrarily deep and a zone only ever has one parent to follow.
  private async isDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
    let cursor: string | null = candidateId;
    while (cursor) {
      if (cursor === ancestorId) return true;
      const zone: { parentZoneId: string | null } | null = await this.prisma.waterZone.findUnique({
        where: { id: cursor },
        select: { parentZoneId: true },
      });
      cursor = zone?.parentZoneId ?? null;
    }
    return false;
  }

  async deleteZone(id: string) {
    const zone = await this.prisma.waterZone.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { children: true, meters: true, customers: true } } },
    });
    const blockers: string[] = [];
    if (zone._count.children > 0) blockers.push(`${zone._count.children} sub-zone(s)`);
    if (zone._count.meters > 0) blockers.push(`${zone._count.meters} meter(s)`);
    if (zone._count.customers > 0) blockers.push(`${zone._count.customers} customer(s)`);
    if (blockers.length > 0) {
      throw new BadRequestException(
        `Can't delete this zone — it still has ${blockers.join(" and ")} assigned to it.`,
      );
    }
    return this.prisma.waterZone.delete({ where: { id } });
  }

  /* ---------- Customers ---------- */

  findAllCustomers(filters: { zoneId?: string; q?: string }, pagination: PaginationQueryDto = {}) {
    return maybePaginate(
      this.prisma.waterCustomer,
      {
        where: {
          ...(filters.zoneId && { zoneId: filters.zoneId }),
          ...(filters.q && { name: { contains: filters.q } }),
        },
        include: { zone: true, meters: { select: { id: true, meterNumber: true } } },
        orderBy: { name: "asc" },
      },
      pagination,
    );
  }

  createCustomer(dto: CreateCustomerDto) {
    return this.prisma.waterCustomer.create({
      data: {
        name: dto.name,
        zoneId: dto.zoneId,
        phone: dto.phone,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCustomer(id: string, dto: UpdateCustomerDto) {
    await this.prisma.waterCustomer.findUniqueOrThrow({ where: { id } });
    return this.prisma.waterCustomer.update({ where: { id }, data: dto });
  }

  async deleteCustomer(id: string) {
    await this.prisma.waterCustomer.findUniqueOrThrow({ where: { id } });
    return this.prisma.waterCustomer.delete({ where: { id } });
  }

  // Everything one customer's detail page needs in one call: profile, all their meters, lifetime
  // totals across every meter, a 6-month trend, and the most recent transactions.
  async getCustomerDetail(id: string, months = 6) {
    const monthCount = Math.min(Math.max(months, 1), 24);
    const customer = await this.prisma.waterCustomer.findUniqueOrThrow({
      where: { id },
      include: { zone: true, meters: { include: { zone: true } } },
    });

    const [totals, recentUsage] = await Promise.all([
      this.prisma.waterUsageRecord.aggregate({
        where: { customerId: id },
        _sum: { unitsSold: true, amountPaid: true },
        _count: true,
        _max: { recordedAt: true },
      }),
      this.prisma.waterUsageRecord.findMany({
        where: { customerId: id },
        orderBy: { recordedAt: "desc" },
        take: 20,
        include: { meter: { select: { id: true, meterNumber: true } } },
      }),
    ]);

    const monthKeys: string[] = [];
    for (let i = monthCount - 1; i >= 0; i--) monthKeys.push(shiftMonth(undefined, -i));
    const monthly = await Promise.all(
      monthKeys.map(async (month) => {
        const { start, end } = monthRange(month);
        const agg = await this.prisma.waterUsageRecord.aggregate({
          where: { customerId: id, recordedAt: { gte: start, lt: end } },
          _sum: { unitsSold: true, amountPaid: true },
        });
        return {
          month,
          unitsSold: Number(agg._sum.unitsSold ?? 0),
          revenue: Number(agg._sum.amountPaid ?? 0),
        };
      }),
    );

    return {
      customer,
      totals: {
        unitsSold: Number(totals._sum.unitsSold ?? 0),
        revenue: Number(totals._sum.amountPaid ?? 0),
        transactionCount: totals._count,
        lastVendAt: totals._max.recordedAt,
      },
      monthly,
      recentUsage,
    };
  }

  private async findOrCreateCustomerByName(name: string, zoneId?: string) {
    const existing = await this.prisma.waterCustomer.findFirst({ where: { name } });
    if (existing) return existing;
    return this.prisma.waterCustomer.create({ data: { name, zoneId } });
  }

  /* ---------- Meters — the primary registration entry point ---------- */

  findAllMeters(
    filters: {
      meterType?: WaterMeterType;
      zoneId?: string;
      q?: string;
      vendingSystem?: WaterVendingSystem;
    },
    pagination: PaginationQueryDto = {},
  ) {
    return maybePaginate(
      this.prisma.waterMeter,
      {
        where: {
          ...(filters.meterType && { meterType: filters.meterType }),
          ...(filters.zoneId && { zoneId: filters.zoneId }),
          ...(filters.q && { meterNumber: { contains: filters.q } }),
          ...(filters.vendingSystem && { vendingSystem: filters.vendingSystem }),
        },
        include: {
          customer: { select: { id: true, name: true } },
          zone: true,
          replacesMeter: { select: { id: true, meterNumber: true, vendingSystem: true } },
          replacedByMeter: { select: { id: true, meterNumber: true, vendingSystem: true } },
          // Last vend date + lifetime count — lets the frontend flag meters that have gone
          // quiet (a strong signal of a broken meter, an inactive customer, or a data gap) at
          // a glance, without a separate round trip per meter.
          usageRecords: {
            orderBy: { recordedAt: "desc" },
            take: 1,
            select: { recordedAt: true },
          },
          // Same idea for main/bulk meters, which have readings instead of usage records.
          readings: {
            orderBy: { readingDate: "desc" },
            take: 1,
            select: { readingDate: true },
          },
          _count: { select: { usageRecords: true } },
        },
        orderBy: { meterNumber: "asc" },
      },
      pagination,
    );
  }

  // When `replacesMeterId` is set and no explicit customer was chosen for the new meter, carry
  // the replaced meter's customer forward — that's what keeps a customer's vending history
  // reading as one continuous story across a physical meter swap (see WaterMeter schema comment).
  private async carryForwardCustomerId(replacesMeterId: string | undefined) {
    if (!replacesMeterId) return undefined;
    const replaced = await this.prisma.waterMeter.findUnique({
      where: { id: replacesMeterId },
      select: { customerId: true },
    });
    return replaced?.customerId ?? undefined;
  }

  async createMeter(dto: CreateMeterDto) {
    const meterType = dto.meterType ?? "household";
    // Main/bulk meters are never assigned a customer — they're identified by name + location,
    // not by who's paying. Silently ignoring customerId/customerName for these types (rather than
    // rejecting them) keeps the form simple: switching the type dropdown just changes which
    // fields matter, without needing to also clear the other set.
    const customerId =
      meterType === "household"
        ? ((await this.resolveCustomerId(dto.customerId, dto.customerName, dto.zoneId)) ??
          (await this.carryForwardCustomerId(dto.replacesMeterId)))
        : undefined;
    return this.prisma.waterMeter.create({
      data: {
        meterNumber: dto.meterNumber,
        meterType,
        name: meterType === "household" ? undefined : dto.name,
        location: meterType === "household" ? undefined : dto.location,
        customerId,
        plotNo: dto.plotNo,
        installedAt: dto.installedAt ? new Date(dto.installedAt) : undefined,
        zoneId: dto.zoneId,
        isActive: dto.isActive ?? true,
        vendingSystem: dto.vendingSystem,
        replacesMeterId: dto.replacesMeterId,
      },
    });
  }

  async updateMeter(id: string, dto: UpdateMeterDto) {
    const existing = await this.prisma.waterMeter.findUniqueOrThrow({ where: { id } });
    const meterType = dto.meterType ?? existing.meterType;
    const explicitCustomerId =
      meterType === "household"
        ? await this.resolveCustomerId(dto.customerId, dto.customerName, dto.zoneId)
        : null;
    // Only carry a customer forward the moment a replacement link is newly set with no customer
    // of its own yet — never on every subsequent unrelated edit of an already-linked meter.
    const isNewReplacementLink =
      dto.replacesMeterId !== undefined && dto.replacesMeterId !== existing.replacesMeterId;
    const customerId =
      explicitCustomerId ??
      (isNewReplacementLink && !existing.customerId
        ? await this.carryForwardCustomerId(dto.replacesMeterId)
        : undefined);
    return this.prisma.waterMeter.update({
      where: { id },
      data: {
        meterNumber: dto.meterNumber,
        meterType: dto.meterType,
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(customerId !== undefined && { customerId }),
        plotNo: dto.plotNo,
        ...(dto.installedAt !== undefined && {
          installedAt: dto.installedAt ? new Date(dto.installedAt) : null,
        }),
        zoneId: dto.zoneId,
        isActive: dto.isActive,
        vendingSystem: dto.vendingSystem,
        ...(dto.replacesMeterId !== undefined && { replacesMeterId: dto.replacesMeterId }),
      },
    });
  }

  // Resolves an explicit customerId first; otherwise finds-or-creates one by name. Returns
  // `undefined` (leave whatever's already set, on update) only when neither was supplied.
  private async resolveCustomerId(
    customerId: string | undefined,
    customerName: string | undefined,
    zoneId: string | undefined,
  ): Promise<string | undefined> {
    if (customerId) return customerId;
    if (customerName?.trim()) {
      const customer = await this.findOrCreateCustomerByName(customerName.trim(), zoneId);
      return customer.id;
    }
    return undefined;
  }

  async deleteMeter(id: string) {
    await this.prisma.waterMeter.findUniqueOrThrow({ where: { id } });
    return this.prisma.waterMeter.delete({ where: { id } });
  }

  // Everything one meter's detail page needs in one call: profile, lifetime totals, a 6-month
  // trend, recent transactions, and (for main/bulk meters) recent dial readings.
  // Household meters are vend-transaction-based (WaterUsageRecord) — main/bulk meters have no
  // vend transactions at all, only dial readings, so their totals/monthly trend are computed from
  // reading deltas instead (meterUsageInPeriod). Using the usage-record path for a main/bulk
  // meter would silently return all-zero every time, which is exactly the bug this branch fixes.
  async getMeterDetail(id: string, months = 6) {
    const monthCount = Math.min(Math.max(months, 1), 24);
    const meter = await this.prisma.waterMeter.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        zone: true,
        replacesMeter: { select: { id: true, meterNumber: true, vendingSystem: true } },
        replacedByMeter: { select: { id: true, meterNumber: true, vendingSystem: true } },
      },
    });

    const monthKeys: string[] = [];
    for (let i = monthCount - 1; i >= 0; i--) monthKeys.push(shiftMonth(undefined, -i));

    if (meter.meterType !== "household") {
      const [readingCount, earliest, latest] = await Promise.all([
        this.prisma.waterMeterReading.count({ where: { meterId: id } }),
        this.prisma.waterMeterReading.findFirst({
          where: { meterId: id },
          orderBy: { readingDate: "asc" },
          select: { value: true },
        }),
        this.prisma.waterMeterReading.findFirst({
          where: { meterId: id },
          orderBy: { readingDate: "desc" },
          select: { value: true, readingDate: true },
        }),
      ]);
      const monthly = await Promise.all(
        monthKeys.map(async (month) => {
          const { start, end } = monthRange(month);
          const usage = await this.meterUsageInPeriod(id, start, end);
          return { month, unitsSold: usage, revenue: 0 };
        }),
      );
      const lifetimeUsage =
        earliest && latest ? Math.max(0, Number(latest.value) - Number(earliest.value)) : 0;

      return {
        meter,
        totals: {
          unitsSold: lifetimeUsage,
          revenue: 0,
          transactionCount: readingCount,
          lastVendAt: latest?.readingDate ?? null,
        },
        monthly,
        recentUsage: [],
      };
    }

    const [totals, recentUsage] = await Promise.all([
      this.prisma.waterUsageRecord.aggregate({
        where: { meterId: id },
        _sum: { unitsSold: true, amountPaid: true },
        _count: true,
        _max: { recordedAt: true },
      }),
      this.prisma.waterUsageRecord.findMany({
        where: { meterId: id },
        orderBy: { recordedAt: "desc" },
        take: 20,
      }),
    ]);

    const monthly = await Promise.all(
      monthKeys.map(async (month) => {
        const { start, end } = monthRange(month);
        const agg = await this.prisma.waterUsageRecord.aggregate({
          where: { meterId: id, recordedAt: { gte: start, lt: end } },
          _sum: { unitsSold: true, amountPaid: true },
        });
        return {
          month,
          unitsSold: Number(agg._sum.unitsSold ?? 0),
          revenue: Number(agg._sum.amountPaid ?? 0),
        };
      }),
    );

    return {
      meter,
      totals: {
        unitsSold: Number(totals._sum.unitsSold ?? 0),
        revenue: Number(totals._sum.amountPaid ?? 0),
        transactionCount: totals._count,
        lastVendAt: totals._max.recordedAt,
      },
      monthly,
      recentUsage,
    };
  }

  /* ---------- Meter readings (main / bulk) ---------- */

  listReadings(
    filters: { meterId?: string; from?: string; to?: string },
    pagination: PaginationQueryDto = {},
  ) {
    return maybePaginate(
      this.prisma.waterMeterReading,
      {
        where: {
          ...(filters.meterId && { meterId: filters.meterId }),
          ...((filters.from || filters.to) && {
            readingDate: {
              ...(filters.from && { gte: new Date(filters.from) }),
              ...(filters.to && { lte: new Date(filters.to) }),
            },
          }),
        },
        include: {
          meter: { select: { id: true, meterNumber: true, meterType: true, zoneId: true } },
        },
        orderBy: { readingDate: "desc" },
      },
      pagination,
    );
  }

  createReading(dto: CreateReadingDto, user: AuthenticatedUser) {
    return this.prisma.waterMeterReading.create({
      data: {
        meterId: dto.meterId,
        readingDate: new Date(dto.readingDate),
        value: dto.value,
        notes: dto.notes,
        createdBy: user.id,
      },
    });
  }

  async updateReading(id: string, dto: UpdateReadingDto) {
    await this.prisma.waterMeterReading.findUniqueOrThrow({ where: { id } });
    return this.prisma.waterMeterReading.update({
      where: { id },
      data: {
        meterId: dto.meterId,
        readingDate: dto.readingDate ? new Date(dto.readingDate) : undefined,
        value: dto.value,
        notes: dto.notes,
      },
    });
  }

  async deleteReading(id: string) {
    await this.prisma.waterMeterReading.findUniqueOrThrow({ where: { id } });
    return this.prisma.waterMeterReading.delete({ where: { id } });
  }

  /* ---------- Usage uploads & records ---------- */

  listUploads(pagination: PaginationQueryDto = {}) {
    return maybePaginate(
      this.prisma.waterUsageUpload,
      {
        include: {
          uploader: { select: { id: true, fullName: true, email: true } },
          _count: { select: { records: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );
  }

  // Rows arrive already parsed (client-side, from CSV/Excel) — each is matched to a registered
  // meter by number, auto-provisioning the meter (and its customer) the first time a meter number
  // is seen so an upload never silently drops a row just because the register hasn't caught up.
  // Deduped on (meterId, recordedAt, unitsSold, amountPaid) before insert — the same natural key
  // used by the one-off CSV import (prisma/seed-water.ts) — so re-uploading the same file, or a
  // file with overlapping rows from a previous upload, never double-counts a transaction.
  async createUpload(dto: CreateUsageUploadDto, user: AuthenticatedUser) {
    const upload = await this.prisma.waterUsageUpload.create({
      data: { fileName: dto.fileName, uploadedBy: user.id, recordCount: 0 },
    });

    let imported = 0;
    let duplicates = 0;
    for (const row of dto.rows) {
      const meter = await this.findOrCreateMeterWithCustomer(row.meterNumber, row.customerName);
      const recordedAt = new Date(row.recordedAt);

      const duplicate = await this.prisma.waterUsageRecord.findFirst({
        where: {
          meterId: meter.id,
          recordedAt,
          unitsSold: row.unitsSold,
          amountPaid: row.amountPaid,
        },
        select: { id: true },
      });
      if (duplicate) {
        duplicates++;
        continue;
      }

      await this.prisma.waterUsageRecord.create({
        data: {
          meterId: meter.id,
          customerId: meter.customerId,
          customerName: row.customerName,
          unitsSold: row.unitsSold,
          amountPaid: row.amountPaid,
          recordedAt,
          source: "upload",
          uploadId: upload.id,
        },
      });
      imported++;
    }

    await this.prisma.waterUsageUpload.update({
      where: { id: upload.id },
      data: { recordCount: imported },
    });
    return {
      ...(await this.prisma.waterUsageUpload.findUniqueOrThrow({
        where: { id: upload.id },
        include: { _count: { select: { records: true } } },
      })),
      duplicatesSkipped: duplicates,
    };
  }

  private async findOrCreateMeterWithCustomer(meterNumber: string, customerName: string) {
    const existing = await this.prisma.waterMeter.findUnique({ where: { meterNumber } });
    if (existing) return existing;

    const customer = await this.findOrCreateCustomerByName(customerName);
    return this.prisma.waterMeter.create({
      data: { meterNumber, meterType: "household", customerId: customer.id },
    });
  }

  listUsageRecords(
    filters: {
      meterId?: string;
      customerId?: string;
      zoneId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    pagination: PaginationQueryDto = {},
  ) {
    return maybePaginate(
      this.prisma.waterUsageRecord,
      {
        where: {
          ...(filters.meterId && { meterId: filters.meterId }),
          ...(filters.customerId && { customerId: filters.customerId }),
          ...(filters.zoneId && { meter: { zoneId: filters.zoneId } }),
          ...((filters.dateFrom || filters.dateTo) && {
            recordedAt: {
              ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
              ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
            },
          }),
        },
        include: { meter: { select: { id: true, meterNumber: true } } },
        orderBy: { recordedAt: "desc" },
      },
      pagination,
    );
  }

  /* ---------- Analytics ---------- */

  // Every zone id whose usage a bulk meter assigned to `zoneId` should be credited with — the
  // zone itself plus every zone nested under it, arbitrarily deep. This is how "one bulk meter
  // can have multiple sub-zones" is satisfied: a bulk meter is assigned to one zone, and that
  // zone's own sub-zone tree defines its full coverage, with no separate many-to-many needed.
  private async zoneAndDescendantIds(zoneId: string): Promise<string[]> {
    const all = await this.prisma.waterZone.findMany({ select: { id: true, parentZoneId: true } });
    const result = new Set<string>([zoneId]);
    let added = true;
    while (added) {
      added = false;
      for (const z of all) {
        if (z.parentZoneId && result.has(z.parentZoneId) && !result.has(z.id)) {
          result.add(z.id);
          added = true;
        }
      }
    }
    return [...result];
  }

  // Main/bulk meters record a cumulative dial value, not a period total — the reading itself
  // never resets, so "usage for August" is (dial value at end of August) minus (dial value at
  // end of July), i.e. always last-reading-to-current-reading, never the raw reading summed on
  // its own. `start`-side value comes from the most recent reading strictly before the window
  // when one exists (carrying the dial forward across period boundaries exactly like a real
  // utility bill); if a meter has no reading before the window at all (its very first reading
  // falls inside this window), there's no known prior dial value, so usage is measured only
  // between readings actually observed inside the window — the sliver of consumption before the
  // first-ever reading is unknowable and deliberately not guessed at.
  private async meterUsageInPeriod(meterId: string, start: Date, end: Date): Promise<number> {
    const [baseline, latestInPeriod, earliestInPeriod] = await Promise.all([
      this.prisma.waterMeterReading.findFirst({
        where: { meterId, readingDate: { lt: start } },
        orderBy: { readingDate: "desc" },
        select: { value: true },
      }),
      this.prisma.waterMeterReading.findFirst({
        where: { meterId, readingDate: { gte: start, lt: end } },
        orderBy: { readingDate: "desc" },
        select: { value: true },
      }),
      this.prisma.waterMeterReading.findFirst({
        where: { meterId, readingDate: { gte: start, lt: end } },
        orderBy: { readingDate: "asc" },
        select: { value: true },
      }),
    ]);
    if (!latestInPeriod) return 0;
    const startValue = baseline ? Number(baseline.value) : Number(earliestInPeriod!.value);
    return Math.max(0, Number(latestInPeriod.value) - startValue);
  }

  // Sums meterUsageInPeriod across every meter of a type (optionally narrowed to a zone + its
  // sub-zones) — the delta-based replacement for what used to be a plain sum of raw reading
  // values (see meterUsageInPeriod's comment for why that was wrong).
  private async readingUsageForType(
    type: WaterMeterType,
    start: Date,
    end: Date,
    zoneIds?: string[],
  ): Promise<number> {
    const meters = await this.prisma.waterMeter.findMany({
      where: { meterType: type, ...(zoneIds && { zoneId: { in: zoneIds } }) },
      select: { id: true },
    });
    if (meters.length === 0) return 0;
    const usages = await Promise.all(meters.map((m) => this.meterUsageInPeriod(m.id, start, end)));
    return usages.reduce((s, v) => s + v, 0);
  }

  // A "zone" filter matches a household meter assigned anywhere in that zone's own sub-tree, not
  // just the exact zone — same reasoning as zoneAndDescendantIds.
  private householdWhere(zoneIds?: string[]) {
    return zoneIds ? { meter: { zoneId: { in: zoneIds } } } : {};
  }

  async dashboard(filters: { zoneId?: string; month?: string }) {
    const { start, end } = monthRange(filters.month);
    const prevMonth = shiftMonth(filters.month, -1);
    const prevRange = monthRange(prevMonth);
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const hhWhere = this.householdWhere(zoneIds);

    const [activeHouseholds, activeMeters, hhAgg, hhPrevAgg, mainTotal, bulkTotal] =
      await Promise.all([
        this.prisma.waterCustomer.count({
          where: { isActive: true, ...(zoneIds && { zoneId: { in: zoneIds } }) },
        }),
        // Every meter type combined (household + bulk + main), unlike activeHouseholds above
        // which is household-customer-only — this is "how many physical meters are actually in
        // service right now" across the whole network, not just the vending/billing side of it.
        this.prisma.waterMeter.count({
          where: { isActive: true, ...(zoneIds && { zoneId: { in: zoneIds } }) },
        }),
        this.prisma.waterUsageRecord.aggregate({
          where: { recordedAt: { gte: start, lt: end }, ...hhWhere },
          _sum: { unitsSold: true, amountPaid: true },
        }),
        this.prisma.waterUsageRecord.aggregate({
          where: { recordedAt: { gte: prevRange.start, lt: prevRange.end }, ...hhWhere },
          _sum: { unitsSold: true },
        }),
        // The main meter (borehole) is never zone-filtered — it covers everything pumped, by
        // definition upstream of every zone.
        this.readingUsageForType("main", start, end),
        this.readingUsageForType("bulk", start, end, zoneIds),
      ]);

    const unitsSold = Number(hhAgg._sum.unitsSold ?? 0);
    const unitsSoldPrev = Number(hhPrevAgg._sum.unitsSold ?? 0);
    const revenue = Number(hhAgg._sum.amountPaid ?? 0);
    const unitsChangePct =
      unitsSoldPrev > 0 ? ((unitsSold - unitsSoldPrev) / unitsSoldPrev) * 100 : null;

    const nrwMainToBulk = mainTotal > 0 ? ((mainTotal - bulkTotal) / mainTotal) * 100 : null;
    const nrwBulkToHousehold = bulkTotal > 0 ? ((bulkTotal - unitsSold) / bulkTotal) * 100 : null;
    const nrwMainToHousehold = mainTotal > 0 ? ((mainTotal - unitsSold) / mainTotal) * 100 : null;

    return {
      month: filters.month ?? shiftMonth(undefined, 0),
      activeHouseholds,
      activeMeters,
      unitsSold,
      unitsSoldChangePct: unitsChangePct,
      revenue,
      mainReadingTotal: mainTotal,
      bulkReadingTotal: bulkTotal,
      nrwMainToBulkPct: nrwMainToBulk,
      nrwBulkToHouseholdPct: nrwBulkToHousehold,
      nrwMainToHouseholdPct: nrwMainToHousehold,
    };
  }

  async trend(filters: { zoneId?: string; months?: number }) {
    const count = Math.min(Math.max(filters.months ?? 6, 1), 24);
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const hhWhere = this.householdWhere(zoneIds);
    const months: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      months.push(shiftMonth(undefined, -i));
    }

    return Promise.all(
      months.map(async (month) => {
        const { start, end } = monthRange(month);
        const [hhAgg, mainTotal, bulkTotal] = await Promise.all([
          this.prisma.waterUsageRecord.aggregate({
            where: { recordedAt: { gte: start, lt: end }, ...hhWhere },
            _sum: { unitsSold: true },
          }),
          this.readingUsageForType("main", start, end),
          this.readingUsageForType("bulk", start, end, zoneIds),
        ]);
        return {
          month,
          mainTotal,
          bulkTotal,
          householdTotal: Number(hhAgg._sum.unitsSold ?? 0),
        };
      }),
    );
  }

  async zoneComparison(filters: { month?: string }) {
    const { start, end } = monthRange(filters.month);
    const zones = await this.prisma.waterZone.findMany({ orderBy: { name: "asc" } });

    return Promise.all(
      zones.map(async (zone) => {
        const zoneIds = await this.zoneAndDescendantIds(zone.id);
        const [bulkTotal, hhAgg] = await Promise.all([
          this.readingUsageForType("bulk", start, end, zoneIds),
          this.prisma.waterUsageRecord.aggregate({
            where: { recordedAt: { gte: start, lt: end }, meter: { zoneId: { in: zoneIds } } },
            _sum: { unitsSold: true },
          }),
        ]);
        return {
          zoneId: zone.id,
          zoneName: zone.name,
          bulkTotal,
          householdTotal: Number(hhAgg._sum.unitsSold ?? 0),
        };
      }),
    );
  }

  async reportSummary(filters: { month?: string }) {
    const month = filters.month ?? shiftMonth(undefined, 0);
    const prevMonth = shiftMonth(month, -1);
    const [dashboard, prevDashboard, zoneStats] = await Promise.all([
      this.dashboard({ month }),
      this.dashboard({ month: prevMonth }),
      this.zoneComparison({ month }),
    ]);

    const zoneLoss = zoneStats
      .map((z) => ({
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        bulkTotal: z.bulkTotal,
        householdTotal: z.householdTotal,
        lossPct: z.bulkTotal > 0 ? ((z.bulkTotal - z.householdTotal) / z.bulkTotal) * 100 : null,
      }))
      .sort((a, b) => (b.lossPct ?? -Infinity) - (a.lossPct ?? -Infinity));
    const worstZone = zoneLoss.find((z) => z.lossPct !== null);
    const bestZone = [...zoneLoss].reverse().find((z) => z.lossPct !== null);

    const insights: string[] = [];
    if (worstZone) {
      insights.push(
        `${worstZone.zoneName} recorded the highest bulk-to-household loss this period at ${worstZone.lossPct!.toFixed(1)}% — the biggest gap between what its bulk meter measured and what was actually billed to households.`,
      );
    }
    if (bestZone && bestZone.zoneId !== worstZone?.zoneId) {
      insights.push(
        `${bestZone.zoneName} is the tightest-reconciled zone at ${bestZone.lossPct!.toFixed(1)}% loss.`,
      );
    }
    if (dashboard.nrwMainToHouseholdPct !== null) {
      insights.push(
        `Non-revenue water between the main meter and billed household consumption sits at ${dashboard.nrwMainToHouseholdPct.toFixed(1)}% — the combined effect of network loss, unbilled use and metering gaps between the borehole and every customer meter.`,
      );
    }
    if (dashboard.nrwMainToBulkPct !== null) {
      insights.push(
        `${dashboard.nrwMainToBulkPct >= 0 ? "Losses" : "A discrepancy"} between the main borehole meter and the sum of zone bulk meters ${dashboard.nrwMainToBulkPct >= 0 ? "stand at" : "of"} ${Math.abs(dashboard.nrwMainToBulkPct).toFixed(1)}% — trunk-line loss before water even reaches a zone.`,
      );
    }
    if (dashboard.unitsSoldChangePct !== null) {
      insights.push(
        `Metered household consumption ${dashboard.unitsSoldChangePct >= 0 ? "grew" : "fell"} ${Math.abs(dashboard.unitsSoldChangePct).toFixed(1)}% month-on-month.`,
      );
    }
    if (prevDashboard.nrwMainToHouseholdPct !== null && dashboard.nrwMainToHouseholdPct !== null) {
      const delta = dashboard.nrwMainToHouseholdPct - prevDashboard.nrwMainToHouseholdPct;
      if (Math.abs(delta) >= 1) {
        insights.push(
          `Non-revenue water ${delta > 0 ? "worsened" : "improved"} by ${Math.abs(delta).toFixed(1)} percentage points versus last month.`,
        );
      }
    }

    return { month, dashboard, prevDashboard, zoneLoss, insights };
  }

  // Bucketed usage comparison (day/week/month) for a meter type, over an explicit date range —
  // powers the Reports page's daily main-meter readings / weekly / monthly comparison views. A
  // reading's delta from its immediate predecessor is attributed to the bucket the *later*
  // reading falls in (the day/week/month the consumption was actually measured on), same
  // last-reading-to-current-reading logic as meterUsageInPeriod, just bucketed instead of
  // collapsed into one number.
  async readingSeries(filters: {
    meterType: WaterMeterType;
    zoneId?: string;
    bucket: "day" | "week" | "month";
    dateFrom: Date;
    dateTo: Date;
  }) {
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const meters = await this.prisma.waterMeter.findMany({
      where: { meterType: filters.meterType, ...(zoneIds && { zoneId: { in: zoneIds } }) },
      select: { id: true },
    });
    if (meters.length === 0) return [];

    const keyFor =
      filters.bucket === "day" ? dayKey : filters.bucket === "week" ? weekKey : monthKeyOf;
    const buckets = new Map<string, { usage: number; readingCount: number }>();

    await Promise.all(
      meters.map(async (m) => {
        const [baseline, readings] = await Promise.all([
          this.prisma.waterMeterReading.findFirst({
            where: { meterId: m.id, readingDate: { lt: filters.dateFrom } },
            orderBy: { readingDate: "desc" },
            select: { value: true },
          }),
          this.prisma.waterMeterReading.findMany({
            where: { meterId: m.id, readingDate: { gte: filters.dateFrom, lte: filters.dateTo } },
            orderBy: { readingDate: "asc" },
            select: { readingDate: true, value: true },
          }),
        ]);
        let prevValue = baseline ? Number(baseline.value) : null;
        for (const r of readings) {
          const value = Number(r.value);
          if (prevValue !== null) {
            const delta = Math.max(0, value - prevValue);
            const key = keyFor(r.readingDate);
            const entry = buckets.get(key) ?? { usage: 0, readingCount: 0 };
            entry.usage += delta;
            entry.readingCount += 1;
            buckets.set(key, entry);
          }
          prevValue = value;
        }
      }),
    );

    return [...buckets.entries()]
      .map(([period, v]) => ({ period, usage: v.usage, readingCount: v.readingCount }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  // The literal reading log for a meter type/zone over a date range, each row carrying its own
  // computed delta from the immediately preceding reading (null when there's no predecessor at
  // all, i.e. a meter's very first-ever reading) — the "daily main meter readings" table.
  async readingsWithDelta(filters: {
    meterId?: string;
    meterType?: WaterMeterType;
    zoneId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const readings = await this.prisma.waterMeterReading.findMany({
      where: {
        ...(filters.meterId && { meterId: filters.meterId }),
        meter: {
          ...(filters.meterType && { meterType: filters.meterType }),
          ...(zoneIds && { zoneId: { in: zoneIds } }),
        },
        ...((filters.dateFrom || filters.dateTo) && {
          readingDate: {
            ...(filters.dateFrom && { gte: filters.dateFrom }),
            ...(filters.dateTo && { lte: filters.dateTo }),
          },
        }),
      },
      include: {
        meter: {
          select: { id: true, meterNumber: true, name: true, meterType: true, zone: true },
        },
      },
      orderBy: { readingDate: "desc" },
    });

    // Need each row's immediate predecessor to compute its delta — fetched once per distinct
    // meter (cheap at this data scale) rather than a query per row.
    const meterIds = [...new Set(readings.map((r) => r.meterId))];
    const historyByMeter = new Map<string, { readingDate: Date; value: unknown }[]>();
    await Promise.all(
      meterIds.map(async (id) => {
        const rows = await this.prisma.waterMeterReading.findMany({
          where: { meterId: id },
          orderBy: { readingDate: "asc" },
          select: { readingDate: true, value: true },
        });
        historyByMeter.set(id, rows);
      }),
    );

    return readings.map((r) => {
      const history = historyByMeter.get(r.meterId) ?? [];
      let prev: { readingDate: Date; value: unknown } | null = null;
      for (const h of history) {
        if (h.readingDate.getTime() < r.readingDate.getTime()) prev = h;
        else break;
      }
      const delta = prev ? Math.max(0, Number(r.value) - Number(prev.value)) : null;
      return { ...r, delta };
    });
  }
}
