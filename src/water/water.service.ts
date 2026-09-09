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

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const MAIN_METER_BOREHOLE_TO_TANK = "Borehole → Tank";
export const MAIN_METER_TANK_TO_DISTRIBUTION = "Tank → Distribution";
export const MAIN_METER_NAMES = [
  MAIN_METER_BOREHOLE_TO_TANK,
  MAIN_METER_TANK_TO_DISTRIBUTION,
] as const;

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

  // Prefers an explicit customerId, else finds-or-creates by name, else leaves unset.
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

  private householdWhere(zoneIds?: string[]) {
    return zoneIds ? { meter: { zoneId: { in: zoneIds } } } : {};
  }

  private async mainMeterUsage(name: string, start: Date, end: Date): Promise<number> {
    const meter = await this.prisma.waterMeter.findFirst({
      where: { meterType: "main", name },
      select: { id: true },
    });
    if (!meter) return 0;
    return this.meterUsageInPeriod(meter.id, start, end);
  }

  private async zoneLossBreakdown(start: Date, end: Date) {
    const zones = await this.prisma.waterZone.findMany({
      select: { id: true, name: true, parentZoneId: true },
      orderBy: { name: "asc" },
    });

    const [bulkByZone, directHouseholdByZone] = await Promise.all([
      Promise.all(zones.map((z) => this.readingUsageForType("bulk", start, end, [z.id]))),
      Promise.all(
        zones.map(async (z) => {
          const agg = await this.prisma.waterUsageRecord.aggregate({
            where: { recordedAt: { gte: start, lt: end }, meter: { zoneId: z.id } },
            _sum: { unitsSold: true },
          });
          return Number(agg._sum.unitsSold ?? 0);
        }),
      ),
    ]);
    const bulkById = new Map(zones.map((z, i) => [z.id, bulkByZone[i]]));
    const directHouseholdById = new Map(zones.map((z, i) => [z.id, directHouseholdByZone[i]]));
    const childrenOf = new Map<string, string[]>();
    for (const z of zones) {
      if (z.parentZoneId) {
        childrenOf.set(z.parentZoneId, [...(childrenOf.get(z.parentZoneId) ?? []), z.id]);
      }
    }

    const rows = zones.map((zone) => {
      const bulkTotal = bulkById.get(zone.id) ?? 0;
      const directHouseholdTotal = directHouseholdById.get(zone.id) ?? 0;
      const childZonesBulkTotal = (childrenOf.get(zone.id) ?? []).reduce(
        (sum, childId) => sum + (bulkById.get(childId) ?? 0),
        0,
      );
      const accountedTotal = directHouseholdTotal + childZonesBulkTotal;
      const lossUnits = bulkTotal - accountedTotal;
      const lossPct = bulkTotal > 0 ? (lossUnits / bulkTotal) * 100 : null;
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        parentZoneId: zone.parentZoneId,
        bulkTotal,
        directHouseholdTotal,
        childZonesBulkTotal,
        accountedTotal,
        lossUnits,
        lossPct,
      };
    });

    const topLevelBulkTotal = rows
      .filter((r) => !r.parentZoneId)
      .reduce((sum, r) => sum + r.bulkTotal, 0);
    const zoneLessHouseholdAgg = await this.prisma.waterUsageRecord.aggregate({
      where: {
        recordedAt: { gte: start, lt: end },
        meter: { zoneId: null, meterType: "household" },
      },
      _sum: { unitsSold: true },
    });
    const zoneLessHouseholdTotal = Number(zoneLessHouseholdAgg._sum.unitsSold ?? 0);

    return { rows, topLevelBulkTotal, zoneLessHouseholdTotal };
  }

  async dashboard(filters: { zoneId?: string; month?: string }) {
    const { start, end } = monthRange(filters.month);
    const prevMonth = shiftMonth(filters.month, -1);
    const prevRange = monthRange(prevMonth);
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const hhWhere = this.householdWhere(zoneIds);

    const [
      activeHouseholds,
      activeMeters,
      hhAgg,
      hhPrevAgg,
      boreholeToTankTotal,
      tankToDistributionTotal,
      bulkTotal,
      zoneLoss,
    ] = await Promise.all([
      this.prisma.waterCustomer.count({
        where: { isActive: true, ...(zoneIds && { zoneId: { in: zoneIds } }) },
      }),
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
      this.mainMeterUsage(MAIN_METER_BOREHOLE_TO_TANK, start, end),
      this.mainMeterUsage(MAIN_METER_TANK_TO_DISTRIBUTION, start, end),
      this.readingUsageForType("bulk", start, end, zoneIds),
      this.zoneLossBreakdown(start, end),
    ]);

    const unitsSold = Number(hhAgg._sum.unitsSold ?? 0);
    const unitsSoldPrev = Number(hhPrevAgg._sum.unitsSold ?? 0);
    const revenue = Number(hhAgg._sum.amountPaid ?? 0);
    const unitsChangePct =
      unitsSoldPrev > 0 ? ((unitsSold - unitsSoldPrev) / unitsSoldPrev) * 100 : null;

    const nrwBoreholeToTank =
      boreholeToTankTotal > 0
        ? ((boreholeToTankTotal - tankToDistributionTotal) / boreholeToTankTotal) * 100
        : null;
    const networkAccountedTotal = zoneLoss.topLevelBulkTotal + zoneLoss.zoneLessHouseholdTotal;
    const nrwTankToNetwork =
      tankToDistributionTotal > 0
        ? ((tankToDistributionTotal - networkAccountedTotal) / tankToDistributionTotal) * 100
        : null;
    const allHouseholdAgg = await this.prisma.waterUsageRecord.aggregate({
      where: { recordedAt: { gte: start, lt: end } },
      _sum: { unitsSold: true },
    });
    const allHouseholdTotal = Number(allHouseholdAgg._sum.unitsSold ?? 0);
    const nrwOverall =
      boreholeToTankTotal > 0
        ? ((boreholeToTankTotal - allHouseholdTotal) / boreholeToTankTotal) * 100
        : null;

    return {
      month: filters.month ?? shiftMonth(undefined, 0),
      activeHouseholds,
      activeMeters,
      unitsSold,
      unitsSoldChangePct: unitsChangePct,
      revenue,
      mainReadingTotal: boreholeToTankTotal,
      bulkReadingTotal: bulkTotal,
      nrwBoreholeToTankPct: nrwBoreholeToTank,
      nrwTankToNetworkPct: nrwTankToNetwork,
      nrwOverallPct: nrwOverall,
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
          this.mainMeterUsage(MAIN_METER_BOREHOLE_TO_TANK, start, end),
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
    const { rows, zoneLessHouseholdTotal } = await this.zoneLossBreakdown(start, end);

    const mapped = rows.map((r) => ({
      zoneId: r.zoneId as string | null,
      zoneName: r.zoneName,
      parentZoneId: r.parentZoneId,
      bulkTotal: r.bulkTotal,
      householdTotal: r.directHouseholdTotal,
      lossUnits: r.lossUnits,
      lossPct: r.lossPct,
    }));
    if (zoneLessHouseholdTotal > 0) {
      mapped.push({
        zoneId: null,
        zoneName: "Unzoned households",
        parentZoneId: null,
        bulkTotal: 0,
        householdTotal: zoneLessHouseholdTotal,
        lossUnits: 0,
        lossPct: null,
      });
    }
    return mapped;
  }

  async reportSummary(filters: { month?: string }) {
    const month = filters.month ?? shiftMonth(undefined, 0);
    const prevMonth = shiftMonth(month, -1);
    const [dashboard, prevDashboard, zoneStats] = await Promise.all([
      this.dashboard({ month }),
      this.dashboard({ month: prevMonth }),
      this.zoneComparison({ month }),
    ]);

    const zoneLoss = [...zoneStats].sort(
      (a, b) => (b.lossPct ?? -Infinity) - (a.lossPct ?? -Infinity),
    );
    const worstZone = zoneLoss.find((z) => z.lossPct !== null);
    const bestZone = [...zoneLoss].reverse().find((z) => z.lossPct !== null);

    const insights: string[] = [];
    if (worstZone) {
      insights.push(
        `${worstZone.zoneName} recorded the highest bulk-to-household loss this period at ${worstZone.lossPct!.toFixed(1)}% — the biggest gap between what its own bulk meter measured and what was actually accounted for (its households plus any of its own sub-zones).`,
      );
    }
    if (bestZone && bestZone.zoneId !== worstZone?.zoneId) {
      insights.push(
        `${bestZone.zoneName} is the tightest-reconciled zone at ${bestZone.lossPct!.toFixed(1)}% loss.`,
      );
    }
    if (dashboard.nrwOverallPct !== null) {
      insights.push(
        `Non-revenue water between the borehole and billed household consumption, network-wide, sits at ${dashboard.nrwOverallPct.toFixed(1)}% — the combined effect of network loss, unbilled use and metering gaps across the whole chain.`,
      );
    }
    if (dashboard.nrwBoreholeToTankPct !== null) {
      insights.push(
        `${dashboard.nrwBoreholeToTankPct >= 0 ? "Losses" : "A discrepancy"} between the borehole and the tank ${dashboard.nrwBoreholeToTankPct >= 0 ? "stand at" : "of"} ${Math.abs(dashboard.nrwBoreholeToTankPct).toFixed(1)}% — transmission loss before the tank even fills.`,
      );
    }
    if (dashboard.nrwTankToNetworkPct !== null) {
      insights.push(
        `${dashboard.nrwTankToNetworkPct >= 0 ? "Losses" : "A discrepancy"} between the tank and the distribution network ${dashboard.nrwTankToNetworkPct >= 0 ? "stand at" : "of"} ${Math.abs(dashboard.nrwTankToNetworkPct).toFixed(1)}% — before water even reaches a zone bulk meter or an unzoned household.`,
      );
    }
    if (dashboard.unitsSoldChangePct !== null) {
      insights.push(
        `Metered household consumption ${dashboard.unitsSoldChangePct >= 0 ? "grew" : "fell"} ${Math.abs(dashboard.unitsSoldChangePct).toFixed(1)}% month-on-month.`,
      );
    }
    if (prevDashboard.nrwOverallPct !== null && dashboard.nrwOverallPct !== null) {
      const delta = dashboard.nrwOverallPct - prevDashboard.nrwOverallPct;
      if (Math.abs(delta) >= 1) {
        insights.push(
          `Non-revenue water ${delta > 0 ? "worsened" : "improved"} by ${Math.abs(delta).toFixed(1)} percentage points versus last month.`,
        );
      }
    }

    return { month, dashboard, prevDashboard, zoneLoss, insights };
  }

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
