import { BadRequestException, Injectable } from "@nestjs/common";
import type { WaterMeterType, WaterVendingSystem } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../common/pagination";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { maskUserRef } from "../common/mask-user-ref";
import type { CreateZoneDto } from "./dto/create-zone.dto";
import type { UpdateZoneDto } from "./dto/update-zone.dto";
import type { CreateCustomerDto } from "./dto/create-customer.dto";
import type { UpdateCustomerDto } from "./dto/update-customer.dto";
import type { CreateMeterDto } from "./dto/create-meter.dto";
import type { UpdateMeterDto } from "./dto/update-meter.dto";
import type { CreateReadingDto } from "./dto/create-reading.dto";
import type { UpdateReadingDto } from "./dto/update-reading.dto";
import type { CreateUsageUploadDto } from "./dto/create-usage-upload.dto";
import { WATER_METER_TYPES, WATER_VENDING_SYSTEMS } from "./dto/create-meter.dto";
import { endOfDay } from "../common/date-range";

// undefined = leave unchanged; null or blank = clear; otherwise the trimmed value.
function nullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${label} is required`);
  return trimmed;
}

function searchTerm(q: string | undefined): string | undefined {
  return q?.trim() || undefined;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function joinWithAnd(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function parseEnumParam<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (!value) return undefined;
  if (!allowed.includes(value as T)) throw new BadRequestException(`Unknown ${label}: ${value}`);
  return value as T;
}

export const parseMeterTypeParam = (v?: string) =>
  parseEnumParam(v, WATER_METER_TYPES, "meter type");
export const parseVendingSystemParam = (v?: string) =>
  parseEnumParam(v, WATER_VENDING_SYSTEMS, "vending system");
export const parseMeterStatusParam = (v?: string) =>
  parseEnumParam(v, ["active", "inactive"] as const, "meter status");

type MeterStatusCounts = Record<WaterMeterType, { active: number; inactive: number }>;

// A date-only upper bound ("2026-09-15") includes that whole day.
function parseDateParam(value: string | undefined, label: string, endOfDay = false) {
  const raw = value?.trim();
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} is not a valid date`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(date.getTime() + 86_399_999);
  return date;
}

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

/** Monday of the week a date falls in, at UTC midnight. */
function weekStart(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const MAIN_METER_BOREHOLE_TO_TANK = "Borehole → Tank";
export const MAIN_METER_TANK_TO_DISTRIBUTION = "Tank → Distribution";
export const MAIN_STAGE_BY_NAME: Record<string, "borehole_to_tank" | "tank_to_network"> = {
  [MAIN_METER_BOREHOLE_TO_TANK]: "borehole_to_tank",
  [MAIN_METER_TANK_TO_DISTRIBUTION]: "tank_to_network",
};

export const MAIN_METER_NAMES = [
  MAIN_METER_BOREHOLE_TO_TANK,
  MAIN_METER_TANK_TO_DISTRIBUTION,
] as const;

@Injectable()
export class WaterService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------- Zones (self-nesting — a zone can sit inside another zone) ---------- */

  async listZones(filters: { q?: string } = {}, pagination: PaginationQueryDto = {}) {
    const q = searchTerm(filters.q);
    const [result, activeByZone] = await Promise.all([
      maybePaginate(
        this.prisma.waterZone,
        {
          where: q ? { name: { contains: q } } : undefined,
          include: {
            parent: { select: { id: true, name: true } },
            _count: { select: { children: true, meters: true, customers: true } },
          },
          orderBy: { name: "asc" },
        },
        pagination,
      ),
      this.prisma.waterMeter.groupBy({
        by: ["zoneId"],
        where: { isActive: true, zoneId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const active = new Map(activeByZone.map((r) => [r.zoneId, r._count._all]));
    const withActive = (rows: { id: string }[]) =>
      rows.map((z) => ({ ...z, activeMeterCount: active.get(z.id) ?? 0 }));
    return Array.isArray(result)
      ? withActive(result)
      : { ...result, data: withActive(result.data as { id: string }[]) };
  }

  listAllZones() {
    return this.prisma.waterZone.findMany({
      select: { id: true, name: true, parentZoneId: true },
      orderBy: { name: "asc" },
    });
  }

  async createZone(dto: CreateZoneDto) {
    const name = requiredText(dto.name, "Zone name");
    const parentZoneId = dto.parentZoneId || null;
    if (parentZoneId) await this.assertZoneExists(parentZoneId, "Parent zone");
    await this.assertZoneNameAvailable(name, parentZoneId);
    return this.prisma.waterZone.create({ data: { name, parentZoneId } });
  }

  async updateZone(id: string, dto: UpdateZoneDto) {
    const zone = await this.prisma.waterZone.findUniqueOrThrow({ where: { id } });
    const name = dto.name === undefined ? zone.name : requiredText(dto.name, "Zone name");
    const parentZoneId =
      dto.parentZoneId === undefined ? zone.parentZoneId : dto.parentZoneId || null;
    if (parentZoneId && parentZoneId !== zone.parentZoneId) {
      if (parentZoneId === id) {
        throw new BadRequestException("A zone can't be its own parent");
      }
      await this.assertZoneExists(parentZoneId, "Parent zone");
      if (await this.isDescendant(parentZoneId, id)) {
        throw new BadRequestException("A zone can't be moved inside one of its own sub-zones");
      }
    }
    if (name !== zone.name || parentZoneId !== zone.parentZoneId) {
      await this.assertZoneNameAvailable(name, parentZoneId, id);
    }
    return this.prisma.waterZone.update({ where: { id }, data: { name, parentZoneId } });
  }

  private async assertZoneExists(zoneId: string, label = "Zone") {
    const found = await this.prisma.waterZone.findUnique({
      where: { id: zoneId },
      select: { id: true },
    });
    if (!found) throw new BadRequestException(`${label} not found — it may have been deleted.`);
  }

  private async assertZoneNameAvailable(
    name: string,
    parentZoneId: string | null,
    exceptId?: string,
  ) {
    const clash = await this.prisma.waterZone.findFirst({
      where: { name, parentZoneId, ...(exceptId && { NOT: { id: exceptId } }) },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        parentZoneId
          ? `A sub-zone named "${name}" already exists in that zone.`
          : `A top-level zone named "${name}" already exists.`,
      );
    }
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
    if (zone._count.children > 0) blockers.push(plural(zone._count.children, "sub-zone"));
    if (zone._count.meters > 0) blockers.push(plural(zone._count.meters, "meter"));
    if (zone._count.customers > 0) blockers.push(plural(zone._count.customers, "customer"));
    if (blockers.length > 0) {
      throw new BadRequestException(
        `Can't delete zone "${zone.name}" — it still has ${joinWithAnd(blockers)}. Move or delete them first.`,
      );
    }
    return this.prisma.waterZone.delete({ where: { id } });
  }

  /* ---------- Customers ---------- */

  async findAllCustomers(
    filters: { zoneId?: string; q?: string },
    pagination: PaginationQueryDto = {},
  ) {
    const q = searchTerm(filters.q);
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    return maybePaginate(
      this.prisma.waterCustomer,
      {
        where: {
          ...(zoneIds && { zoneId: { in: zoneIds } }),
          ...(q && {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
              { meters: { some: { meterNumber: { contains: q } } } },
            ],
          }),
        },
        include: { zone: true, meters: { select: { id: true, meterNumber: true } } },
        orderBy: { name: "asc" },
      },
      pagination,
    );
  }

  async createCustomer(dto: CreateCustomerDto) {
    const zoneId = dto.zoneId || null;
    if (zoneId) await this.assertZoneExists(zoneId);
    return this.prisma.waterCustomer.create({
      data: {
        name: requiredText(dto.name, "Customer name"),
        zoneId,
        phone: nullableText(dto.phone) ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCustomer(id: string, dto: UpdateCustomerDto) {
    await this.prisma.waterCustomer.findUniqueOrThrow({ where: { id } });
    const zoneId = nullableText(dto.zoneId);
    if (zoneId) await this.assertZoneExists(zoneId);
    return this.prisma.waterCustomer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: requiredText(dto.name, "Customer name") }),
        zoneId,
        phone: nullableText(dto.phone),
        isActive: dto.isActive,
      },
    });
  }

  // Meters and usage records keep their data; the schema sets their customer link to null.
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

  async findAllMeters(
    filters: {
      meterType?: WaterMeterType;
      zoneId?: string;
      q?: string;
      vendingSystem?: WaterVendingSystem;
      status?: "active" | "inactive";
    },
    pagination: PaginationQueryDto = {},
  ) {
    const q = searchTerm(filters.q);
    const meterZoneIds = filters.zoneId
      ? await this.zoneAndDescendantIds(filters.zoneId)
      : undefined;
    return maybePaginate(
      this.prisma.waterMeter,
      {
        where: {
          ...(filters.status && { isActive: filters.status === "active" }),
          ...(filters.meterType && { meterType: filters.meterType }),
          ...(meterZoneIds && { zoneId: { in: meterZoneIds } }),
          ...(q && {
            OR: [
              { meterNumber: { contains: q } },
              { name: { contains: q } },
              { location: { contains: q } },
              { plotNo: { contains: q } },
              { customer: { name: { contains: q } } },
            ],
          }),
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
          _count: { select: { usageRecords: true, readings: true } },
        },
        orderBy: { meterNumber: "asc" },
      },
      pagination,
    );
  }

  private async carryForwardCustomerId(replacesMeterId: string | null | undefined) {
    if (!replacesMeterId) return undefined;
    const replaced = await this.prisma.waterMeter.findUnique({
      where: { id: replacesMeterId },
      select: { customerId: true },
    });
    return replaced?.customerId ?? undefined;
  }

  async createMeter(dto: CreateMeterDto) {
    const meterType = dto.meterType ?? "household";
    const isHousehold = meterType === "household";
    const meterNumber = requiredText(dto.meterNumber, "Meter number");
    const zoneId = dto.zoneId || null;
    const replacesMeterId = dto.replacesMeterId || null;
    await this.assertMeterNumberAvailable(meterNumber);
    if (zoneId) await this.assertZoneExists(zoneId);
    if (replacesMeterId) await this.assertReplaceable(replacesMeterId);
    const customerId = isHousehold
      ? ((await this.resolveCustomerId(dto.customerId, dto.customerName, zoneId)) ??
        (await this.carryForwardCustomerId(replacesMeterId)))
      : undefined;
    const meter = await this.prisma.waterMeter.create({
      data: {
        meterNumber,
        meterType,
        mainStage: meterType === "main" ? (dto.mainStage ?? null) : null,
        name: isHousehold ? undefined : nullableText(dto.name),
        location: isHousehold ? undefined : nullableText(dto.location),
        customerId,
        plotNo: nullableText(dto.plotNo),
        installedAt: dto.installedAt ? new Date(dto.installedAt) : undefined,
        zoneId,
        isActive: dto.isActive ?? true,
        vendingSystem: dto.vendingSystem,
        replacesMeterId,
      },
    });
    if (replacesMeterId) await this.retireMeter(replacesMeterId);
    return meter;
  }

  async updateMeter(id: string, dto: UpdateMeterDto) {
    const existing = await this.prisma.waterMeter.findUniqueOrThrow({ where: { id } });
    const meterType = dto.meterType ?? existing.meterType;
    const isHousehold = meterType === "household";
    const typeChanged = meterType !== existing.meterType;

    const meterNumber =
      dto.meterNumber === undefined ? undefined : requiredText(dto.meterNumber, "Meter number");
    if (meterNumber && meterNumber !== existing.meterNumber) {
      await this.assertMeterNumberAvailable(meterNumber, id);
    }
    const zoneId = nullableText(dto.zoneId);
    if (zoneId && zoneId !== existing.zoneId) await this.assertZoneExists(zoneId);
    const replacesMeterId = nullableText(dto.replacesMeterId);
    const isNewReplacementLink =
      replacesMeterId !== undefined && replacesMeterId !== existing.replacesMeterId;
    if (replacesMeterId && isNewReplacementLink) await this.assertReplaceable(replacesMeterId, id);

    // Main/bulk meters never carry a customer; household meters resolve or carry one forward.
    let customerId: string | null | undefined;
    if (!isHousehold) {
      customerId = existing.customerId ? null : undefined;
    } else if (dto.customerId === null) {
      customerId = null;
    } else {
      customerId =
        (await this.resolveCustomerId(
          dto.customerId,
          dto.customerName,
          zoneId === undefined ? existing.zoneId : zoneId,
        )) ??
        (isNewReplacementLink && !existing.customerId
          ? await this.carryForwardCustomerId(replacesMeterId)
          : undefined);
    }

    const meter = await this.prisma.waterMeter.update({
      where: { id },
      data: {
        meterNumber,
        meterType: dto.meterType,
        mainStage:
          (dto.meterType ?? existing.meterType) === "main"
            ? (dto.mainStage ?? (typeChanged ? null : undefined))
            : null,
        name: isHousehold ? (typeChanged ? null : undefined) : nullableText(dto.name),
        location: isHousehold ? (typeChanged ? null : undefined) : nullableText(dto.location),
        customerId,
        plotNo: !isHousehold && typeChanged ? null : nullableText(dto.plotNo),
        installedAt:
          dto.installedAt === undefined
            ? undefined
            : dto.installedAt
              ? new Date(dto.installedAt)
              : null,
        zoneId,
        isActive: dto.isActive,
        vendingSystem: dto.vendingSystem,
        replacesMeterId,
      },
    });
    if (replacesMeterId && isNewReplacementLink) await this.retireMeter(replacesMeterId);
    return meter;
  }

  private retireMeter(id: string) {
    return this.prisma.waterMeter.update({ where: { id }, data: { isActive: false } });
  }

  private async assertMeterNumberAvailable(meterNumber: string, exceptId?: string) {
    const clash = await this.prisma.waterMeter.findUnique({
      where: { meterNumber },
      select: { id: true },
    });
    if (clash && clash.id !== exceptId) {
      throw new BadRequestException(`Meter number "${meterNumber}" is already registered.`);
    }
  }

  private async assertReplaceable(replacesMeterId: string, selfId?: string) {
    if (replacesMeterId === selfId) throw new BadRequestException("A meter can't replace itself.");
    const target = await this.prisma.waterMeter.findUnique({
      where: { id: replacesMeterId },
      select: { meterNumber: true, replacedByMeter: { select: { id: true, meterNumber: true } } },
    });
    if (!target) throw new BadRequestException("The meter being replaced was not found.");
    if (target.replacedByMeter && target.replacedByMeter.id !== selfId) {
      throw new BadRequestException(
        `Meter ${target.meterNumber} is already marked as replaced by ${target.replacedByMeter.meterNumber}.`,
      );
    }
  }

  // Prefers an explicit customerId, else finds-or-creates by name, else leaves unset.
  private async resolveCustomerId(
    customerId: string | null | undefined,
    customerName: string | undefined,
    zoneId: string | null | undefined,
  ): Promise<string | undefined> {
    if (customerId) {
      const found = await this.prisma.waterCustomer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!found) throw new BadRequestException("Customer not found — it may have been deleted.");
      return customerId;
    }
    if (customerName?.trim()) {
      const customer = await this.findOrCreateCustomerByName(
        customerName.trim(),
        zoneId ?? undefined,
      );
      return customer.id;
    }
    return undefined;
  }

  // Readings and usage records cascade with the meter (schema onDelete: Cascade).
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

  async listReadings(
    filters: {
      meterId?: string;
      meterType?: WaterMeterType;
      zoneId?: string;
      q?: string;
      from?: string;
      to?: string;
    },
    pagination: PaginationQueryDto = {},
  ) {
    const from = parseDateParam(filters.from, "From date");
    const to = parseDateParam(filters.to, "To date", true);
    const q = searchTerm(filters.q);
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const meterWhere = {
      ...(filters.meterType && { meterType: filters.meterType }),
      ...(zoneIds && { zoneId: { in: zoneIds } }),
      ...(q && {
        OR: [
          { meterNumber: { contains: q } },
          { name: { contains: q } },
          { location: { contains: q } },
        ],
      }),
    };
    return maybePaginate(
      this.prisma.waterMeterReading,
      {
        where: {
          ...(filters.meterId && { meterId: filters.meterId }),
          ...(Object.keys(meterWhere).length > 0 && { meter: meterWhere }),
          ...((from || to) && {
            readingDate: { ...(from && { gte: from }), ...(to && { lte: to }) },
          }),
        },
        include: {
          meter: {
            select: {
              id: true,
              meterNumber: true,
              meterType: true,
              name: true,
              zoneId: true,
              zone: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { readingDate: "desc" },
      },
      pagination,
    );
  }

  // Dial readings belong to main and bulk meters only.
  private async assertReadingMeter(meterId: string) {
    const meter = await this.prisma.waterMeter.findUnique({
      where: { id: meterId },
      select: { meterType: true, meterNumber: true, isActive: true },
    });
    if (!meter) throw new BadRequestException("Meter not found — it may have been deleted.");
    if (!meter.isActive) {
      throw new BadRequestException(
        `Meter ${meter.meterNumber} is inactive (not in use). Switch it back to Active to record readings.`,
      );
    }
  }

  async createReading(dto: CreateReadingDto, user: AuthenticatedUser) {
    await this.assertReadingMeter(dto.meterId);
    return this.prisma.waterMeterReading.create({
      data: {
        meterId: dto.meterId,
        readingDate: new Date(dto.readingDate),
        value: dto.value,
        notes: nullableText(dto.notes),
        createdBy: user.id,
      },
    });
  }

  async updateReading(id: string, dto: UpdateReadingDto) {
    const existing = await this.prisma.waterMeterReading.findUniqueOrThrow({ where: { id } });
    if (dto.meterId && dto.meterId !== existing.meterId) await this.assertReadingMeter(dto.meterId);
    return this.prisma.waterMeterReading.update({
      where: { id },
      data: {
        meterId: dto.meterId,
        readingDate: dto.readingDate ? new Date(dto.readingDate) : undefined,
        value: dto.value,
        notes: nullableText(dto.notes),
      },
    });
  }

  async deleteReading(id: string) {
    await this.prisma.waterMeterReading.findUniqueOrThrow({ where: { id } });
    return this.prisma.waterMeterReading.delete({ where: { id } });
  }

  /* ---------- Usage uploads & records ---------- */

  // `month` (YYYY-MM) matches uploads holding records dated that month, or uploaded that month.
  async listUploads(
    viewer: AuthenticatedUser,
    filters: { q?: string; month?: string } = {},
    pagination: PaginationQueryDto = {},
  ) {
    const q = searchTerm(filters.q);
    const month = filters.month?.trim();
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException("Month must look like YYYY-MM");
    }
    const range = month ? monthRange(month) : undefined;
    const result = await maybePaginate(
      this.prisma.waterUsageUpload,
      {
        where: {
          ...(q && { fileName: { contains: q } }),
          ...(range && {
            OR: [
              { records: { some: { recordedAt: { gte: range.start, lt: range.end } } } },
              { createdAt: { gte: range.start, lt: range.end } },
            ],
          }),
        },
        include: {
          uploader: {
            select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
          },
          _count: { select: { records: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );

    const rows = Array.isArray(result) ? result : result.data;
    const periods =
      rows.length > 0
        ? await this.prisma.waterUsageRecord.groupBy({
            by: ["uploadId"],
            where: { uploadId: { in: rows.map((r) => r.id) } },
            _min: { recordedAt: true },
            _max: { recordedAt: true },
          })
        : [];
    const periodByUpload = new Map(periods.map((p) => [p.uploadId, p]));
    type UploaderRef = Parameters<typeof maskUserRef>[0] | null;
    const withPeriod = (rows as ((typeof rows)[number] & { uploader: UploaderRef })[]).map((r) => ({
      ...r,
      uploader: r.uploader ? maskUserRef(r.uploader, viewer) : null,
      periodStart: periodByUpload.get(r.id)?._min.recordedAt ?? null,
      periodEnd: periodByUpload.get(r.id)?._max.recordedAt ?? null,
    }));
    return Array.isArray(result) ? withPeriod : { ...result, data: withPeriod };
  }

  // Removes the upload and the usage records it imported; auto-registered meters/customers stay.
  async deleteUpload(id: string) {
    await this.prisma.waterUsageUpload.findUniqueOrThrow({ where: { id } });
    const [records] = await this.prisma.$transaction([
      this.prisma.waterUsageRecord.deleteMany({ where: { uploadId: id } }),
      this.prisma.waterUsageUpload.delete({ where: { id } }),
    ]);
    return { id, recordsDeleted: records.count };
  }

  async createUpload(dto: CreateUsageUploadDto, user: AuthenticatedUser) {
    const upload = await this.prisma.waterUsageUpload.create({
      data: { fileName: dto.fileName, uploadedBy: user.id, recordCount: 0 },
    });

    let imported = 0;
    let duplicates = 0;
    const inactiveMeters = new Set<string>();
    for (const row of dto.rows) {
      const meter = await this.findOrCreateMeterWithCustomer(
        row.meterNumber,
        row.customerName,
        dto.vendingSystem,
      );
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
      if (!meter.isActive) inactiveMeters.add(meter.meterNumber);
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
      inactiveMeterNumbers: [...inactiveMeters],
    };
  }

  // mPaya payer names vary per payment, so mPaya meters get no customer record from uploads.
  private async findOrCreateMeterWithCustomer(
    meterNumber: string,
    customerName: string,
    vendingSystem: "amsol" | "mpaya" = "amsol",
  ) {
    const existing = await this.prisma.waterMeter.findUnique({ where: { meterNumber } });
    if (existing) return existing;
    if (vendingSystem === "mpaya") {
      return this.prisma.waterMeter.create({
        data: { meterNumber, meterType: "household", vendingSystem },
      });
    }
    const customer = await this.findOrCreateCustomerByName(customerName);
    return this.prisma.waterMeter.create({
      data: { meterNumber, meterType: "household", vendingSystem, customerId: customer.id },
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

  /**
   * What households actually drew, and how we know.
   *
   * A dial reading is the water that truly passed the meter. Tokens are credit
   * bought, which may be used weeks later — so where readings exist we use them,
   * and where they do not we fall back to tokens and say so.
   */
  private async householdConsumption(
    start: Date,
    end: Date,
    zoneIds?: string[],
  ): Promise<{ units: number; basis: "readings" | "tokens"; metersRead: number }> {
    const metered = await this.prisma.waterMeterReading.findMany({
      where: {
        readingDate: { gte: start, lt: end },
        meter: { meterType: "household", ...(zoneIds && { zoneId: { in: zoneIds } }) },
      },
      select: { meterId: true },
      distinct: ["meterId"],
    });
    if (metered.length > 0) {
      const units = await this.readingUsageForType("household", start, end, zoneIds);
      return { units, basis: "readings", metersRead: metered.length };
    }
    const tokens = await this.prisma.waterUsageRecord.aggregate({
      where: { recordedAt: { gte: start, lt: end }, ...this.householdWhere(zoneIds) },
      _sum: { unitsSold: true },
    });
    return { units: Number(tokens._sum.unitsSold ?? 0), basis: "tokens", metersRead: 0 };
  }

  /** Water that left the network for a reason someone wrote down. */
  private async adjustmentsInPeriod(start: Date, end: Date, zoneIds?: string[]) {
    const rows = await this.prisma.waterNetworkAdjustment.findMany({
      where: {
        occurredAt: { gte: start, lt: end },
        ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
      },
      select: { units: true, kind: true },
    });
    const total = rows.reduce((sum, r) => sum + Number(r.units), 0);
    const byKind: Record<string, number> = {};
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + Number(r.units);
    return { total, byKind, count: rows.length };
  }

  listAdjustments(filters: { zoneId?: string; from?: Date; to?: Date }) {
    return this.prisma.waterNetworkAdjustment.findMany({
      where: {
        ...(filters.zoneId && { zoneId: filters.zoneId }),
        ...((filters.from || filters.to) && {
          occurredAt: {
            ...(filters.from && { gte: filters.from }),
            ...(filters.to && { lte: filters.to }),
          },
        }),
      },
      include: { zone: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
  }

  createAdjustment(
    dto: {
      zoneId?: string | null;
      occurredAt: string;
      units: number;
      kind?: string;
      note?: string;
    },
    userId: string,
  ) {
    return this.prisma.waterNetworkAdjustment.create({
      data: {
        zoneId: dto.zoneId || null,
        occurredAt: new Date(dto.occurredAt),
        units: dto.units,
        kind: (dto.kind ?? "line_fill") as "line_fill",
        note: dto.note?.trim() || null,
        createdBy: userId,
      },
    });
  }

  async deleteAdjustment(id: string) {
    await this.prisma.waterNetworkAdjustment.delete({ where: { id } });
    return { id };
  }

  private householdWhere(zoneIds?: string[]) {
    return zoneIds ? { meter: { zoneId: { in: zoneIds } } } : {};
  }

  private async mainMeterUsage(name: string, start: Date, end: Date): Promise<number> {
    const stage = MAIN_STAGE_BY_NAME[name];
    const meters = await this.prisma.waterMeter.findMany({
      // Older meters have no stage yet, so the name still counts as a fallback.
      where: { meterType: "main", OR: [{ mainStage: stage }, { mainStage: null, name }] },
      select: { id: true },
    });
    const usages = await Promise.all(meters.map((m) => this.meterUsageInPeriod(m.id, start, end)));
    return usages.reduce((sum, v) => sum + v, 0);
  }

  /* ---------------- One zone, opened ---------------- */

  /** Everything about one zone: what is under it, what it measures, how it did. */
  async zoneDetail(zoneId: string, month?: string) {
    const zone = await this.prisma.waterZone.findUniqueOrThrow({
      where: { id: zoneId },
      include: { parent: { select: { id: true, name: true } } },
    });
    const { start, end } = monthRange(month);
    const descendants = await this.zoneAndDescendantIds(zoneId);
    const childIds = descendants.filter((id) => id !== zoneId);

    const [children, meters, customers, bulkTotal, childBulkTotal, households, revenue] =
      await Promise.all([
        this.prisma.waterZone.findMany({
          where: { parentZoneId: zoneId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.waterMeter.findMany({
          where: { zoneId },
          include: { customer: { select: { id: true, name: true } } },
          orderBy: [{ meterType: "asc" }, { meterNumber: "asc" }],
        }),
        this.prisma.waterCustomer.count({ where: { zoneId } }),
        this.readingUsageForType("bulk", start, end, [zoneId]),
        childIds.length
          ? this.readingUsageForType("bulk", start, end, childIds)
          : Promise.resolve(0),
        this.prisma.waterUsageRecord.aggregate({
          where: { recordedAt: { gte: start, lt: end }, meter: { zoneId } },
          _sum: { unitsSold: true },
        }),
        this.prisma.waterUsageRecord.aggregate({
          where: { recordedAt: { gte: start, lt: end }, meter: { zoneId } },
          _sum: { amountPaid: true },
        }),
      ]);

    // A zone's own loss: its bulk meter, less the zones beneath it, less its own plots.
    const directHouseholdTotal = Number(households._sum.unitsSold ?? 0);
    const accounted = directHouseholdTotal + childBulkTotal;
    const lossUnits = bulkTotal > 0 ? bulkTotal - accounted : 0;
    const lossPct = bulkTotal > 0 ? (lossUnits / bulkTotal) * 100 : null;

    const bulkMeters = meters.filter((m) => m.meterType === "bulk");
    const householdMeters = meters.filter((m) => m.meterType === "household");

    return {
      ...zone,
      month: month ?? shiftMonth(undefined, 0),
      children,
      bulkMeters,
      householdMeters,
      customerCount: customers,
      activeHouseholdMeters: householdMeters.filter((m) => m.isActive).length,
      hasBulkMeter: bulkMeters.length > 0,
      bulkTotal,
      childBulkTotal,
      directHouseholdTotal,
      accountedTotal: accounted,
      lossUnits,
      lossPct,
      revenue: Number(revenue._sum.amountPaid ?? 0),
    };
  }

  /** Moves meters into a zone, or out to the main line when zoneId is null. */
  async assignMetersToZone(zoneId: string | null, meterIds: string[]) {
    if (meterIds.length === 0) return { moved: 0 };
    if (zoneId) await this.prisma.waterZone.findUniqueOrThrow({ where: { id: zoneId } });
    const meters = await this.prisma.waterMeter.findMany({
      where: { id: { in: meterIds } },
      select: { id: true, meterType: true, customerId: true },
    });
    const moved = await this.prisma.waterMeter.updateMany({
      where: { id: { in: meters.map((m) => m.id) } },
      data: { zoneId },
    });
    // A household's customer record follows its meter, so both agree on the zone.
    const customerIds = meters.flatMap((m) => (m.customerId ? [m.customerId] : []));
    if (customerIds.length > 0) {
      await this.prisma.waterCustomer.updateMany({
        where: { id: { in: customerIds } },
        data: { zoneId },
      });
    }
    return { moved: moved.count };
  }

  /** Meters not yet placed in any zone, so they can be put where they belong. */
  async unassignedMeters(type?: WaterMeterType) {
    return this.prisma.waterMeter.findMany({
      where: { zoneId: null, meterType: type ?? { in: ["bulk", "household"] } },
      select: {
        id: true,
        meterNumber: true,
        meterType: true,
        plotNo: true,
        isActive: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: [{ meterType: "asc" }, { plotNo: "asc" }, { meterNumber: "asc" }],
      take: 500,
    });
  }

  /** Every zone's usage per period, for comparing zones on one chart. */
  async zoneSeries(filters: { granularity?: "week" | "month"; periods?: number }) {
    const zones = await this.prisma.waterZone.findMany({
      select: { id: true, name: true, parentZoneId: true },
      orderBy: { name: "asc" },
    });
    const windows = this.periodWindows(filters.granularity, filters.periods);

    const rows = await Promise.all(
      zones.map(async (zone) => {
        const points = await Promise.all(
          windows.map(async (w) => {
            const [bulk, sold, revenue] = await Promise.all([
              this.readingUsageForType("bulk", w.start, w.end, [zone.id]),
              this.prisma.waterUsageRecord.aggregate({
                where: { recordedAt: { gte: w.start, lt: w.end }, meter: { zoneId: zone.id } },
                _sum: { unitsSold: true },
              }),
              this.prisma.waterUsageRecord.aggregate({
                where: { recordedAt: { gte: w.start, lt: w.end }, meter: { zoneId: zone.id } },
                _sum: { amountPaid: true },
              }),
            ]);
            return {
              period: w.period,
              bulkUnits: bulk,
              householdUnits: Number(sold._sum.unitsSold ?? 0),
              revenue: Number(revenue._sum.amountPaid ?? 0),
            };
          }),
        );
        return { zoneId: zone.id, zoneName: zone.name, parentZoneId: zone.parentZoneId, points };
      }),
    );
    return { periods: windows.map((w) => w.period), zones: rows };
  }

  /** Each main and bulk meter's usage per period, for comparing meters. */
  async meterSeries(filters: {
    granularity?: "week" | "month";
    periods?: number;
    meterType?: WaterMeterType;
  }) {
    const meters = await this.prisma.waterMeter.findMany({
      where: {
        meterType: filters.meterType ?? { in: ["main", "bulk"] },
        isActive: true,
      },
      select: {
        id: true,
        meterNumber: true,
        name: true,
        meterType: true,
        mainStage: true,
        zone: { select: { id: true, name: true } },
      },
      orderBy: [{ meterType: "asc" }, { meterNumber: "asc" }],
    });
    const windows = this.periodWindows(filters.granularity, filters.periods);

    const rows = await Promise.all(
      meters.map(async (m) => {
        const points = await Promise.all(
          windows.map(async (w) => ({
            period: w.period,
            units: await this.meterUsageInPeriod(m.id, w.start, w.end),
          })),
        );
        return {
          meterId: m.id,
          meterNumber: m.meterNumber,
          label: m.name ?? m.meterNumber,
          meterType: m.meterType,
          mainStage: m.mainStage,
          zoneId: m.zone?.id ?? null,
          zoneName: m.zone?.name ?? null,
          points,
        };
      }),
    );
    return { periods: windows.map((w) => w.period), meters: rows };
  }

  /** The week or month windows a comparison chart runs over, oldest first. */
  private periodWindows(granularity: "week" | "month" = "month", periods?: number) {
    const weekly = granularity === "week";
    const count = Math.min(Math.max(periods ?? (weekly ? 12 : 6), 1), weekly ? 52 : 24);
    const windows: { period: string; start: Date; end: Date }[] = [];
    if (weekly) {
      const thisWeek = weekStart(new Date());
      for (let i = count - 1; i >= 0; i--) {
        const start = addDays(thisWeek, -7 * i);
        windows.push({ period: dayKey(start), start, end: addDays(start, 7) });
      }
    } else {
      for (let i = count - 1; i >= 0; i--) {
        const month = shiftMonth(undefined, -i);
        windows.push({ period: month, ...monthRange(month) });
      }
    }
    return windows;
  }

  private async meterStatusCounts(zoneIds?: string[]): Promise<MeterStatusCounts> {
    const rows = await this.prisma.waterMeter.groupBy({
      by: ["meterType", "isActive"],
      where: zoneIds ? { zoneId: { in: zoneIds } } : undefined,
      _count: { _all: true },
    });
    const counts: MeterStatusCounts = {
      main: { active: 0, inactive: 0 },
      bulk: { active: 0, inactive: 0 },
      household: { active: 0, inactive: 0 },
    };
    for (const r of rows) counts[r.meterType][r.isActive ? "active" : "inactive"] = r._count._all;
    return counts;
  }

  private async zoneLossBreakdown(start: Date, end: Date) {
    const zones = await this.prisma.waterZone.findMany({
      select: { id: true, name: true, parentZoneId: true },
      orderBy: { name: "asc" },
    });

    const [bulkByZone, consumptionByZone, boughtByZone, adjustmentByZone] = await Promise.all([
      Promise.all(zones.map((z) => this.readingUsageForType("bulk", start, end, [z.id]))),
      Promise.all(zones.map((z) => this.householdConsumption(start, end, [z.id]))),
      Promise.all(
        zones.map(async (z) => {
          const agg = await this.prisma.waterUsageRecord.aggregate({
            where: { recordedAt: { gte: start, lt: end }, meter: { zoneId: z.id } },
            _sum: { unitsSold: true },
          });
          return Number(agg._sum.unitsSold ?? 0);
        }),
      ),
      Promise.all(zones.map((z) => this.adjustmentsInPeriod(start, end, [z.id]))),
    ]);
    const directHouseholdByZone = consumptionByZone.map((c) => c.units);
    const bulkById = new Map(zones.map((z, i) => [z.id, bulkByZone[i]]));
    const directHouseholdById = new Map(zones.map((z, i) => [z.id, directHouseholdByZone[i]]));
    const basisById = new Map(zones.map((z, i) => [z.id, consumptionByZone[i].basis]));
    const boughtById = new Map(zones.map((z, i) => [z.id, boughtByZone[i]]));
    const adjustmentById = new Map(zones.map((z, i) => [z.id, adjustmentByZone[i].total]));
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
      const adjustmentTotal = adjustmentById.get(zone.id) ?? 0;
      const boughtTotal = boughtById.get(zone.id) ?? 0;
      const basis = basisById.get(zone.id) ?? "tokens";
      // Known volumes are accounted for, so they never show up as unexplained.
      const accountedTotal = directHouseholdTotal + childZonesBulkTotal + adjustmentTotal;
      const lossUnits = bulkTotal - accountedTotal;
      const lossPct = bulkTotal > 0 ? (lossUnits / bulkTotal) * 100 : null;
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        parentZoneId: zone.parentZoneId,
        bulkTotal,
        directHouseholdTotal,
        childZonesBulkTotal,
        adjustmentTotal,
        boughtTotal,
        // "readings" is what was drawn; "tokens" is what was paid for, which may be
        // used later — so a single period on tokens is provisional.
        consumptionBasis: basis,
        provisional: basis === "tokens",
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
      meterStatus,
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
      this.meterStatusCounts(zoneIds),
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

    const statusTotals = Object.values(meterStatus);
    const activeMeters = statusTotals.reduce((sum, c) => sum + c.active, 0);
    const inactiveMeters = statusTotals.reduce((sum, c) => sum + c.inactive, 0);
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
    const [consumption, adjustments, allBoughtAgg] = await Promise.all([
      this.householdConsumption(start, end),
      this.adjustmentsInPeriod(start, end),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: start, lt: end } },
        _sum: { unitsSold: true },
      }),
    ]);
    const allHouseholdTotal = consumption.units + adjustments.total;
    const allBoughtTotal = Number(allBoughtAgg._sum.unitsSold ?? 0);
    const nrwOverall =
      boreholeToTankTotal > 0
        ? ((boreholeToTankTotal - allHouseholdTotal) / boreholeToTankTotal) * 100
        : null;

    return {
      month: filters.month ?? shiftMonth(undefined, 0),
      activeHouseholds,
      activeMeters,
      inactiveMeters,
      meterStatus,
      unitsSold,
      unitsSoldChangePct: unitsChangePct,
      revenue,
      mainReadingTotal: boreholeToTankTotal,
      bulkReadingTotal: bulkTotal,
      // Kept apart on purpose: a bulk meter measures a whole zone, a household
      // meter measures one plot. Averaging them together means nothing.
      averages: {
        perHouseholdMeter:
          meterStatus.household.active > 0 ? unitsSold / meterStatus.household.active : null,
        perBulkMeter: meterStatus.bulk.active > 0 ? bulkTotal / meterStatus.bulk.active : null,
        householdMeters: meterStatus.household.active,
        bulkMeters: meterStatus.bulk.active,
      },
      nrwBoreholeToTankPct: nrwBoreholeToTank,
      nrwTankToNetworkPct: nrwTankToNetwork,
      nrwOverallPct: nrwOverall,
      // Three different things, never added together:
      //   released — what the meters passed; bought — credit paid for;
      //   used — what households actually drew, when their dials have been read.
      water: {
        released: boreholeToTankTotal,
        intoNetwork: tankToDistributionTotal,
        used: consumption.units,
        bought: allBoughtTotal,
        accountedAdjustments: adjustments.total,
        adjustmentsByKind: adjustments.byKind,
        consumptionBasis: consumption.basis,
        householdMetersRead: consumption.metersRead,
        // Tokens are bought before they are used, so one period never settles.
        provisional: consumption.basis === "tokens",
        unusedCredit: consumption.basis === "readings" ? allBoughtTotal - consumption.units : null,
      },
    };
  }

  /**
   * The same sums over several periods at once. Buying tokens ahead of using them
   * washes out over months, so this is the figure to trust over any single one.
   */
  async settled(filters: { months?: number }) {
    const months = Math.min(Math.max(filters.months ?? 6, 2), 24);
    const from = monthRange(shiftMonth(undefined, -(months - 1))).start;
    const to = monthRange(shiftMonth(undefined, 0)).end;

    const [released, intoNetwork, consumption, adjustments, boughtAgg] = await Promise.all([
      this.mainMeterUsage(MAIN_METER_BOREHOLE_TO_TANK, from, to),
      this.mainMeterUsage(MAIN_METER_TANK_TO_DISTRIBUTION, from, to),
      this.householdConsumption(from, to),
      this.adjustmentsInPeriod(from, to),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: from, lt: to } },
        _sum: { unitsSold: true },
      }),
    ]);
    const bought = Number(boughtAgg._sum.unitsSold ?? 0);
    const accounted = consumption.units + adjustments.total;
    const unaccounted = released - accounted;

    return {
      months,
      from,
      to,
      released,
      intoNetwork,
      used: consumption.units,
      bought,
      accountedAdjustments: adjustments.total,
      adjustmentsByKind: adjustments.byKind,
      consumptionBasis: consumption.basis,
      unaccounted,
      unaccountedPct: released > 0 ? (unaccounted / released) * 100 : null,
      // Over a long window the two should converge; a wide gap means credit is
      // being banked, not that water went missing.
      boughtLessUsed: bought - consumption.units,
    };
  }

  /** The same three totals per period, by week or by month, oldest first. */
  async trend(filters: {
    zoneId?: string;
    months?: number;
    granularity?: "week" | "month";
    periods?: number;
  }) {
    const weekly = filters.granularity === "week";
    const asked = filters.periods ?? filters.months ?? (weekly ? 12 : 6);
    const count = Math.min(Math.max(asked, 1), weekly ? 52 : 24);
    const zoneIds = filters.zoneId ? await this.zoneAndDescendantIds(filters.zoneId) : undefined;
    const hhWhere = this.householdWhere(zoneIds);

    const windows: { period: string; month: string; start: Date; end: Date }[] = [];
    if (weekly) {
      const thisWeek = weekStart(new Date());
      for (let i = count - 1; i >= 0; i--) {
        const start = addDays(thisWeek, -7 * i);
        const end = addDays(start, 7);
        windows.push({ period: dayKey(start), month: monthKeyOf(start), start, end });
      }
    } else {
      for (let i = count - 1; i >= 0; i--) {
        const month = shiftMonth(undefined, -i);
        windows.push({ period: month, month, ...monthRange(month) });
      }
    }

    return Promise.all(
      windows.map(async (w) => {
        const [hhAgg, mainTotal, bulkTotal] = await Promise.all([
          this.prisma.waterUsageRecord.aggregate({
            where: { recordedAt: { gte: w.start, lt: w.end }, ...hhWhere },
            _sum: { unitsSold: true },
          }),
          this.mainMeterUsage(MAIN_METER_BOREHOLE_TO_TANK, w.start, w.end),
          this.readingUsageForType("bulk", w.start, w.end, zoneIds),
        ]);
        return {
          period: w.period,
          granularity: weekly ? ("week" as const) : ("month" as const),
          month: w.month,
          periodStart: w.start,
          periodEnd: w.end,
          mainTotal,
          bulkTotal,
          householdTotal: Number(hhAgg._sum.unitsSold ?? 0),
        };
      }),
    );
  }

  async zoneComparison(filters: { month?: string; dateFrom?: Date; dateTo?: Date }) {
    const { start, end } =
      filters.dateFrom && filters.dateTo
        ? { start: filters.dateFrom, end: endOfDay(filters.dateTo) }
        : monthRange(filters.month);
    const { rows, zoneLessHouseholdTotal } = await this.zoneLossBreakdown(start, end);

    const mapped = rows.map((r) => ({
      zoneId: r.zoneId as string | null,
      zoneName: r.zoneName,
      parentZoneId: r.parentZoneId,
      bulkTotal: r.bulkTotal,
      householdTotal: r.directHouseholdTotal,
      directHouseholdTotal: r.directHouseholdTotal,
      childZonesBulkTotal: r.childZonesBulkTotal,
      accountedTotal: r.accountedTotal,
      adjustmentTotal: r.adjustmentTotal,
      boughtTotal: r.boughtTotal,
      consumptionBasis: r.consumptionBasis,
      provisional: r.provisional,
      lossUnits: r.lossUnits,
      lossPct: r.lossPct,
    }));
    if (zoneLessHouseholdTotal > 0) {
      mapped.push({
        zoneId: null,
        zoneName: "On the main line",
        parentZoneId: null,
        bulkTotal: 0,
        householdTotal: zoneLessHouseholdTotal,
        directHouseholdTotal: zoneLessHouseholdTotal,
        childZonesBulkTotal: 0,
        accountedTotal: zoneLessHouseholdTotal,
        adjustmentTotal: 0,
        boughtTotal: zoneLessHouseholdTotal,
        consumptionBasis: "tokens" as const,
        provisional: true,
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
    if (dashboard.inactiveMeters > 0) {
      insights.push(
        `${dashboard.inactiveMeters} meter${dashboard.inactiveMeters === 1 ? " is" : "s are"} inactive (not in use) and ${dashboard.activeMeters} active. Inactive meters are left out of active counts; their past readings and sales still count in the months they happened.`,
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
            where: {
              meterId: m.id,
              readingDate: { gte: filters.dateFrom, lte: endOfDay(filters.dateTo) },
            },
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
            ...(filters.dateTo && { lte: endOfDay(filters.dateTo) }),
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
