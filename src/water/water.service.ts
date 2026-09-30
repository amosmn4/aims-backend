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
import type { RetireMeterDto } from "./dto/retire-meter.dto";
import {
  balancePeriods,
  balanceUsageInWindow,
  type BalanceFlag,
  type BalancePurchase,
  type BalanceReading,
} from "./household-balance";
import type { CreateUsageUploadDto } from "./dto/create-usage-upload.dto";
import { WATER_METER_TYPES, WATER_VENDING_SYSTEMS } from "./dto/create-meter.dto";
import { endOfDay } from "../common/date-range";
import {
  HISTORY_DAYS,
  assessGap,
  estimateFromHistory,
  gapNote,
  riseNote,
  wholeUnits,
  type HouseholdSide,
  type WaterVerdict,
} from "./loss-assessment";
import { dialFlow } from "./meter-flow";

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

// Opening balances older than this are too stale to split usage by window.
const BALANCE_LOOKBACK_DAYS = 400;
// Enough earlier periods for a household's usual daily use.
const BALANCE_BASELINE_DAYS = 210;
const FLAG_RANK: Record<BalanceFlag, number> = { balance_too_high: 0, no_use: 1, high_use: 2 };

function groupBalanceReadings(
  rows: { id: string; meterId: string; readingDate: Date; value: unknown }[],
) {
  const map = new Map<string, BalanceReading[]>();
  for (const r of rows) {
    const list = map.get(r.meterId) ?? [];
    list.push({ id: r.id, readingDate: r.readingDate, value: Number(r.value) });
    map.set(r.meterId, list);
  }
  return map;
}

/** Meters in these zones. A null entry also takes meters that have no zone. */
function inZones(zoneIds: (string | null)[]) {
  const named = zoneIds.filter((id): id is string => id !== null);
  return zoneIds.includes(null)
    ? { OR: [{ zoneId: { in: named } }, { zoneId: null }] }
    : { zoneId: { in: named } };
}

/** In use at some point in the period: installed before it ended, not retired before it began. */
function meterActiveIn(
  m: { isActive: boolean; installedAt: Date | null; deactivatedAt: Date | null },
  start: Date,
  end: Date,
) {
  if (m.installedAt && m.installedAt >= end) return false;
  return m.isActive || (m.deactivatedAt !== null && m.deactivatedAt >= start);
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
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
        where: { isActive: true, meterType: "household", zoneId: { not: null } },
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

  // Two people can share a name, so a typed name is always a new customer.
  private createCustomerNamed(name: string, zoneId?: string) {
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
        deactivatedAt: dto.isActive === false ? new Date() : undefined,
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
        ...(dto.isActive === true &&
          !existing.isActive && { deactivatedAt: null, inactiveReason: null, inactiveNote: null }),
        ...(dto.isActive === false && existing.isActive && { deactivatedAt: new Date() }),
        vendingSystem: dto.vendingSystem,
        replacesMeterId,
      },
    });
    if (replacesMeterId && isNewReplacementLink) await this.retireMeter(replacesMeterId);
    return meter;
  }

  private async retireMeter(id: string) {
    const meter = await this.prisma.waterMeter.findUniqueOrThrow({
      where: { id },
      select: { deactivatedAt: true },
    });
    return this.prisma.waterMeter.update({
      where: { id },
      data: {
        isActive: false,
        inactiveReason: "replaced",
        deactivatedAt: meter.deactivatedAt ?? new Date(),
      },
    });
  }

  /**
   * Takes a meter out of use without losing anything: records its final reading,
   * marks why it left, and (when replaced) registers the new meter in the same step.
   */
  async takeMeterOutOfUse(id: string, dto: RetireMeterDto, user: AuthenticatedUser) {
    const meter = await this.prisma.waterMeter.findUniqueOrThrow({ where: { id } });
    if (!meter.isActive) {
      throw new BadRequestException(`Meter ${meter.meterNumber} is already out of use.`);
    }
    const date = new Date(dto.date);
    const newMeterNumber =
      dto.reason === "replaced" && dto.newMeterNumber?.trim() ? dto.newMeterNumber.trim() : null;
    if (newMeterNumber) {
      await this.assertMeterNumberAvailable(newMeterNumber);
      await this.assertReplaceable(id);
    }
    if (dto.finalReading != null) {
      await this.assertNoReadingAt(id, date);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.finalReading != null) {
        await tx.waterMeterReading.create({
          data: {
            meterId: id,
            readingDate: date,
            value: dto.finalReading,
            notes: "Final reading",
            createdBy: user.id,
          },
        });
      }
      const retired = await tx.waterMeter.update({
        where: { id },
        data: {
          isActive: false,
          deactivatedAt: date,
          inactiveReason: dto.reason,
          inactiveNote: nullableText(dto.note) ?? null,
        },
      });
      if (!newMeterNumber) return { meter: retired, newMeter: null };

      const newMeter = await tx.waterMeter.create({
        data: {
          meterNumber: newMeterNumber,
          meterType: meter.meterType,
          mainStage: meter.mainStage,
          name: meter.name,
          location: meter.location,
          customerId: meter.customerId,
          plotNo: meter.plotNo,
          zoneId: meter.zoneId,
          vendingSystem: meter.vendingSystem,
          installedAt: date,
          replacesMeterId: id,
        },
      });
      if (dto.newMeterReading != null) {
        await tx.waterMeterReading.create({
          data: {
            meterId: newMeter.id,
            readingDate: date,
            value: dto.newMeterReading,
            notes: "Starting reading",
            createdBy: user.id,
          },
        });
      }
      return { meter: retired, newMeter };
    });
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

  // Prefers an explicit customerId, else creates one from the name, else leaves unset.
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
      const customer = await this.createCustomerNamed(customerName.trim(), zoneId ?? undefined);
      return customer.id;
    }
    return undefined;
  }

  // Only a meter with no history can be deleted; anything else is taken out of use.
  async deleteMeter(id: string) {
    const meter = await this.prisma.waterMeter.findUniqueOrThrow({
      where: { id },
      select: {
        meterNumber: true,
        _count: { select: { readings: true, usageRecords: true } },
      },
    });
    const { readings, usageRecords } = meter._count;
    if (readings > 0 || usageRecords > 0) {
      const history = [
        readings > 0 && plural(readings, "reading"),
        usageRecords > 0 && plural(usageRecords, "purchase"),
      ].filter((x): x is string => !!x);
      throw new BadRequestException(
        `Meter ${meter.meterNumber} has ${joinWithAnd(history)}, so it can't be deleted. Take it out of use instead; its history stays in reports.`,
      );
    }
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
    // Without a type or meter, the list is network (dial) readings; balances are listed on request.
    const meterWhere = {
      ...(filters.meterType
        ? { meterType: filters.meterType }
        : !filters.meterId && { meterType: { not: "household" as const } }),
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

  private async assertNoReadingAt(meterId: string, readingDate: Date, exceptId?: string) {
    const clash = await this.prisma.waterMeterReading.findFirst({
      where: { meterId, readingDate, ...(exceptId && { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException("This meter already has a reading at that date and time.");
    }
  }

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
    await this.assertNoReadingAt(dto.meterId, new Date(dto.readingDate));
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
    if (dto.readingDate || dto.meterId) {
      await this.assertNoReadingAt(
        dto.meterId ?? existing.meterId,
        dto.readingDate ? new Date(dto.readingDate) : existing.readingDate,
        id,
      );
    }
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
    const customer = await this.createCustomerNamed(customerName);
    return this.prisma.waterMeter.create({
      data: { meterNumber, meterType: "household", vendingSystem, customerId: customer.id },
    });
  }

  async listUsageRecords(
    filters: {
      meterId?: string;
      customerId?: string;
      zoneId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    pagination: PaginationQueryDto = {},
  ) {
    // The estate zone's own records include meters that have no zone.
    const ownZones = filters.zoneId ? (await this.zoneTree()).ownIds(filters.zoneId) : undefined;
    return maybePaginate(
      this.prisma.waterUsageRecord,
      {
        where: {
          ...(filters.meterId && { meterId: filters.meterId }),
          ...(filters.customerId && { customerId: filters.customerId }),
          ...(ownZones && { meter: inZones(ownZones) }),
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

  /**
   * The zone tree as sets. A single top-level zone is the whole estate: every
   * meter is under it. Its own meters are the main line; a meter with no zone has
   * no place recorded and counts only in the estate's whole.
   */
  private async zoneTree() {
    const zones = await this.prisma.waterZone.findMany({
      select: { id: true, name: true, parentZoneId: true },
      orderBy: { name: "asc" },
    });
    const known = new Set(zones.map((z) => z.id));
    const childrenOf = new Map<string, string[]>();
    const roots: string[] = [];
    for (const z of zones) {
      if (z.parentZoneId && known.has(z.parentZoneId)) {
        childrenOf.set(z.parentZoneId, [...(childrenOf.get(z.parentZoneId) ?? []), z.id]);
      } else {
        roots.push(z.id);
      }
    }
    const estateId = roots.length === 1 ? roots[0] : null;
    const children = (id: string) => childrenOf.get(id) ?? [];
    const descendants = (id: string): string[] => [id, ...children(id).flatMap(descendants)];
    /** The zone without the zones inside it. */
    const ownIds = (id: string): (string | null)[] => [id];
    /** The zone together with every zone inside it. */
    const wholeIds = (id: string): (string | null)[] =>
      id === estateId ? [...descendants(id), null] : descendants(id);
    return { zones, roots, estateId, children, ownIds, wholeIds };
  }

  private async meterUsageInPeriod(meterId: string, start: Date, end: Date): Promise<number> {
    return (await this.meterUsageMeasured(meterId, start, end)) ?? 0;
  }

  /** How far the dial moved in the period, or null when two readings don't bound it. */
  private async meterUsageMeasured(meterId: string, start: Date, end: Date) {
    return (await this.meterFlow(meterId, start, end))?.units ?? null;
  }

  /** Dial movement inside the period and the dates it covers, or null when not bounded. */
  private async meterFlow(meterId: string, start: Date, end: Date) {
    const select = { value: true, readingDate: true };
    const inside = { meterId, readingDate: { gte: start, lt: end } };
    const [before, first, last, after] = await Promise.all([
      this.prisma.waterMeterReading.findFirst({
        where: { meterId, readingDate: { lt: start } },
        orderBy: { readingDate: "desc" },
        select,
      }),
      this.prisma.waterMeterReading.findFirst({
        where: inside,
        orderBy: { readingDate: "asc" },
        select,
      }),
      this.prisma.waterMeterReading.findFirst({
        where: inside,
        orderBy: { readingDate: "desc" },
        select,
      }),
      this.prisma.waterMeterReading.findFirst({
        where: { meterId, readingDate: { gte: end } },
        orderBy: { readingDate: "asc" },
        select,
      }),
    ]);
    const dial = (r: { value: unknown; readingDate: Date } | null) =>
      r && { at: r.readingDate, value: Number(r.value) };
    return dialFlow(
      { before: dial(before), first: dial(first), last: dial(last), after: dial(after) },
      start,
      end,
    );
  }

  /** Bulk volume counted once: the outermost meters, not the inner zones again. */
  private async outerBulkTotal(start: Date, end: Date, zoneId?: string) {
    const ids = zoneId ? [zoneId] : (await this.zoneTree()).roots;
    const flows = await Promise.all(ids.map((id) => this.zoneBulkFlow(id, start, end)));
    return flows.reduce((sum, flow) => sum + flow.units, 0);
  }

  /** What a zone's bulk meters passed, and the reading dates that bound it. */
  private async zoneBulkFlow(zoneId: string, start: Date, end: Date) {
    const meters = await this.prisma.waterMeter.findMany({
      where: { meterType: "bulk", zoneId },
      select: { id: true },
    });
    const flows = (await Promise.all(meters.map((m) => this.meterFlow(m.id, start, end)))).filter(
      (flow) => flow !== null,
    );
    const times = (pick: "from" | "to") => flows.map((flow) => flow[pick].getTime());
    return {
      hasMeter: meters.length > 0,
      measured: flows.length > 0,
      units: flows.reduce((sum, flow) => sum + flow.units, 0),
      from: flows.length > 0 ? new Date(Math.min(...times("from"))) : null,
      to: flows.length > 0 ? new Date(Math.max(...times("to"))) : null,
    };
  }

  /**
   * What households actually drew, and how we know.
   *
   * Household readings are prepaid balances: used = opening balance + units bought
   * − closing balance. Meters with two balances around the window are measured;
   * the rest fall back to tokens bought in the window.
   */
  private async householdConsumption(
    start: Date,
    end: Date,
    zoneIds?: (string | null)[],
  ): Promise<{ units: number; basis: "readings" | "tokens"; metersRead: number }> {
    const lookback = addDays(start, -BALANCE_LOOKBACK_DAYS);
    const readings = await this.prisma.waterMeterReading.findMany({
      where: {
        readingDate: { gte: lookback, lt: end },
        meter: { meterType: "household", ...(zoneIds && inZones(zoneIds)) },
      },
      select: { id: true, meterId: true, readingDate: true, value: true },
    });
    const byMeter = groupBalanceReadings(readings);
    const purchases = await this.balancePurchases([...byMeter.keys()], lookback, end);

    let measuredUnits = 0;
    const measured: string[] = [];
    for (const [meterId, meterReadings] of byMeter) {
      const res = balanceUsageInWindow(meterReadings, purchases.get(meterId) ?? [], start, end);
      if (!res) continue;
      measured.push(meterId);
      measuredUnits += res.used;
    }

    const tokens = await this.prisma.waterUsageRecord.aggregate({
      where: {
        recordedAt: { gte: start, lt: end },
        ...this.householdWhere(zoneIds),
        ...(measured.length > 0 && { meterId: { notIn: measured } }),
      },
      _sum: { unitsSold: true },
    });
    return {
      units: measuredUnits + Number(tokens._sum.unitsSold ?? 0),
      basis: measured.length > 0 ? "readings" : "tokens",
      metersRead: measured.length,
    };
  }

  private async balancePurchases(meterIds: string[], after: Date, end: Date) {
    const map = new Map<string, BalancePurchase[]>();
    if (meterIds.length === 0) return map;
    const rows = await this.prisma.waterUsageRecord.findMany({
      where: { meterId: { in: meterIds }, recordedAt: { gt: after, lt: end } },
      select: { meterId: true, recordedAt: true, unitsSold: true },
    });
    for (const r of rows) {
      const list = map.get(r.meterId) ?? [];
      list.push({ recordedAt: r.recordedAt, units: Number(r.unitsSold) });
      map.set(r.meterId, list);
    }
    return map;
  }

  /* ---------------- Household balances ---------------- */

  /** Every balance reading on one household meter, with what was used in each period. */
  async meterBalancePeriods(meterId: string) {
    const meter = await this.prisma.waterMeter.findUniqueOrThrow({
      where: { id: meterId },
      select: { id: true, meterType: true },
    });
    if (meter.meterType !== "household") {
      throw new BadRequestException("Balances are only read on household meters.");
    }
    const [readings, purchases] = await Promise.all([
      this.prisma.waterMeterReading.findMany({
        where: { meterId },
        orderBy: { readingDate: "asc" },
        select: { id: true, readingDate: true, value: true, notes: true },
      }),
      this.prisma.waterUsageRecord.findMany({
        where: { meterId },
        select: { recordedAt: true, unitsSold: true },
      }),
    ]);
    const periods = balancePeriods(
      readings.map((r) => ({ id: r.id, readingDate: r.readingDate, value: Number(r.value) })),
      purchases.map((p) => ({ recordedAt: p.recordedAt, units: Number(p.unitsSold) })),
    );
    const periodByReading = new Map(periods.map((p) => [p.readingId, p]));
    return readings
      .map((r) => ({
        id: r.id,
        readingDate: r.readingDate,
        balance: Number(r.value),
        notes: r.notes,
        period: periodByReading.get(r.id) ?? null,
      }))
      .reverse();
  }

  /** Households whose latest balance periods need a look, most serious first. */
  async householdFlags(months = 3) {
    const since = addDays(new Date(), -Math.min(Math.max(months, 1), 12) * 30);
    const lookback = addDays(since, -BALANCE_BASELINE_DAYS);
    const readings = await this.prisma.waterMeterReading.findMany({
      where: { readingDate: { gte: lookback }, meter: { meterType: "household" } },
      select: { id: true, meterId: true, readingDate: true, value: true },
    });
    const byMeter = groupBalanceReadings(readings);
    const purchases = await this.balancePurchases(
      [...byMeter.keys()],
      lookback,
      addDays(new Date(), 1),
    );

    const flagged: {
      meterId: string;
      flag: BalanceFlag;
      period: ReturnType<typeof balancePeriods>[number];
    }[] = [];
    for (const [meterId, meterReadings] of byMeter) {
      const periods = balancePeriods(meterReadings, purchases.get(meterId) ?? []);
      const latest = [...periods].reverse().find((p) => p.to >= since && p.flags.length > 0);
      if (latest) flagged.push({ meterId, flag: latest.flags[0], period: latest });
    }
    if (flagged.length === 0) return [];

    const meters = await this.prisma.waterMeter.findMany({
      where: { id: { in: flagged.map((f) => f.meterId) } },
      select: {
        id: true,
        meterNumber: true,
        isActive: true,
        customer: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });
    const meterById = new Map(meters.map((m) => [m.id, m]));
    return flagged
      .map((f) => ({ ...f, meter: meterById.get(f.meterId)! }))
      .filter((f) => f.meter)
      .sort(
        (a, b) =>
          FLAG_RANK[a.flag] - FLAG_RANK[b.flag] || b.period.to.getTime() - a.period.to.getTime(),
      );
  }

  /** Water that left the network for a reason someone wrote down. */
  private async adjustmentsInPeriod(start: Date, end: Date, zoneIds?: (string | null)[]) {
    const rows = await this.prisma.waterNetworkAdjustment.findMany({
      where: {
        occurredAt: { gte: start, lt: end },
        ...(zoneIds ? inZones(zoneIds) : {}),
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

  private householdWhere(zoneIds?: (string | null)[]) {
    return zoneIds ? { meter: inZones(zoneIds) } : {};
  }

  private async mainMeterUsage(name: string, start: Date, end: Date): Promise<number> {
    return (await this.mainStageFlow(name, start, end)).units;
  }

  /** A main stage's volume, and whether its dial was read often enough to know it. */
  private async mainStageFlow(name: string, start: Date, end: Date) {
    const stage = MAIN_STAGE_BY_NAME[name];
    const meters = await this.prisma.waterMeter.findMany({
      // Older meters have no stage yet, so the name still counts as a fallback.
      where: { meterType: "main", OR: [{ mainStage: stage }, { mainStage: null, name }] },
      select: { id: true },
    });
    const flows = (await Promise.all(meters.map((m) => this.meterFlow(m.id, start, end)))).filter(
      (flow) => flow !== null,
    );
    const times = (pick: "from" | "to") => flows.map((flow) => flow[pick].getTime());
    return {
      units: flows.reduce((sum, flow) => sum + flow.units, 0),
      measured: flows.length > 0,
      from: flows.length > 0 ? new Date(Math.min(...times("from"))) : null,
      to: flows.length > 0 ? new Date(Math.max(...times("to"))) : null,
    };
  }

  /**
   * What left the tanks. A tank outlet main meter if there is one; otherwise the
   * estate zone's bulk meter, which sits just after the tanks and covers everything.
   */
  private async outletFlow(start: Date, end: Date) {
    const tank = await this.mainStageFlow(MAIN_METER_TANK_TO_DISTRIBUTION, start, end);
    const asTank = { ...tank, source: "tank_outlet" as const, what: "the tank outlet meter" };
    if (tank.measured) return asTank;
    const { estateId, zones } = await this.zoneTree();
    if (!estateId) return asTank;
    const estate = await this.zoneBulkFlow(estateId, start, end);
    if (!estate.hasMeter) return asTank;
    const name = zones.find((z) => z.id === estateId)!.name;
    return {
      units: estate.units,
      measured: estate.measured,
      from: estate.from,
      to: estate.to,
      source: "estate_bulk" as const,
      what: `the ${name} bulk meter`,
    };
  }

  /**
   * What households took in a window, with typical use and carried credit from
   * their earlier purchases, so a gap can be weighed before it is called a loss.
   */
  private async householdSide(
    from: Date,
    to: Date,
    zoneIds?: (string | null)[],
  ): Promise<HouseholdSide> {
    const [consumption, history] = await Promise.all([
      this.householdConsumption(from, to, zoneIds),
      this.prisma.waterUsageRecord.findMany({
        where: {
          recordedAt: { gte: addDays(from, -HISTORY_DAYS), lt: from },
          ...this.householdWhere(zoneIds),
        },
        select: { recordedAt: true, unitsSold: true },
      }),
    ]);
    const purchases = history.map((p) => ({
      recordedAt: p.recordedAt,
      units: Number(p.unitsSold),
    }));
    return {
      taken: consumption.units,
      basis: consumption.basis,
      ...estimateFromHistory(purchases, from, to),
    };
  }

  /**
   * Released water against what households took, over the dates the source meter
   * was read. The source is what left the tanks once that is read; until then the borehole.
   */
  private async reconcile(
    start: Date,
    end: Date,
    borehole: Awaited<ReturnType<WaterService["mainStageFlow"]>>,
    tankOutlet: Awaited<ReturnType<WaterService["outletFlow"]>>,
  ) {
    const fromTank = tankOutlet.measured;
    const source = fromTank ? tankOutlet : borehole;
    const what = fromTank ? tankOutlet.what : "the borehole meter";
    const from = source.from ?? start;
    const to = source.to ? new Date(source.to.getTime() + 1) : end;
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const [household, adjustments, before] = await Promise.all([
      this.householdSide(from, to),
      this.adjustmentsInPeriod(from, to),
      fromTank
        ? this.outletFlow(prevStart, start)
        : this.mainStageFlow(MAIN_METER_BOREHOLE_TO_TANK, prevStart, start),
    ]);
    const assessment = assessGap({
      measured: source.measured,
      passed: source.units,
      adjustments: adjustments.total,
      household,
    });
    const takenBefore =
      before.from && before.to
        ? (await this.householdConsumption(before.from, new Date(before.to.getTime() + 1))).units
        : 0;
    return {
      source: fromTank ? tankOutlet.source : ("borehole" as const),
      sourceName: what,
      measured: source.measured,
      from: source.from,
      to: source.to,
      released: source.units,
      householdUnits: household.taken,
      basis: household.basis,
      // What households typically use over these days, and credit bought earlier.
      expectedUnits: household.expected,
      carriedCredit: household.carried,
      adjustments: adjustments.total,
      ...assessment,
      note: gapNote({
        what,
        from: source.from,
        to: source.to,
        passed: source.units,
        household,
        assessment,
      }),
      riseNote:
        source.from && source.to && before.from && before.to
          ? riseNote({
              what,
              now: { units: source.units, days: daysBetween(source.from, source.to) },
              before: { units: before.units, days: daysBetween(before.from, before.to) },
              taken: household.taken,
              takenBefore,
              basis: household.basis,
              verdict: assessment.verdict,
            })
          : null,
    };
  }

  /**
   * Household water paid for in a period: per zone against its meter count and
   * spend, and the meters that bought the most.
   */
  private async householdUsageBreakdown(start: Date, end: Date) {
    const [{ zones, estateId }, allMeters, sales] = await Promise.all([
      this.zoneTree(),
      this.prisma.waterMeter.findMany({
        where: { meterType: "household" },
        select: {
          id: true,
          meterNumber: true,
          plotNo: true,
          zoneId: true,
          isActive: true,
          installedAt: true,
          deactivatedAt: true,
          customer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.waterUsageRecord.groupBy({
        by: ["meterId"],
        where: { recordedAt: { gte: start, lt: end }, meter: { meterType: "household" } },
        _sum: { unitsSold: true, amountPaid: true },
        _count: { _all: true },
      }),
    ]);
    // A meter counts for the period it was in use, whatever its status today.
    const meters = allMeters.map((m) => ({ ...m, isActive: meterActiveIn(m, start, end) }));
    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const meterById = new Map(meters.map((m) => [m.id, m]));
    const bought = sales.flatMap((r) => {
      const meter = meterById.get(r.meterId);
      if (!meter) return [];
      return [
        {
          meter,
          units: Number(r._sum.unitsSold ?? 0),
          amount: Number(r._sum.amountPaid ?? 0),
          purchases: r._count._all,
        },
      ];
    });

    const blank = () => ({
      activeMeters: 0,
      inactiveMeters: 0,
      buyingMeters: 0,
      units: 0,
      revenue: 0,
    });
    // A meter with no zone has no place recorded. Under an estate zone it still
    // counts in the estate's whole, on a line of its own.
    const UNPLACED = "unplaced";
    const MAIN_LINE = "main-line";
    const OUT_OF_USE = "out-of-use";
    const placeOf = (m: { zoneId: string | null; isActive: boolean }) =>
      m.zoneId ?? (estateId ? UNPLACED : m.isActive ? MAIN_LINE : OUT_OF_USE);
    const placeName = (place: string) =>
      place === UNPLACED
        ? "No zone recorded"
        : place === MAIN_LINE
          ? "On the main line"
          : place === OUT_OF_USE
            ? "Out of use, no zone"
            : (zoneById.get(place)?.name ?? "Unknown zone");
    const byPlace = new Map<string, ReturnType<typeof blank>>();
    const at = (place: string) => {
      if (!byPlace.has(place)) byPlace.set(place, blank());
      return byPlace.get(place)!;
    };
    for (const z of zones) at(z.id);
    for (const m of meters) at(placeOf(m))[m.isActive ? "activeMeters" : "inactiveMeters"]++;
    for (const r of bought) {
      const row = at(placeOf(r.meter));
      row.buyingMeters++;
      row.units += r.units;
      row.revenue += r.amount;
    }
    const totalUnits = bought.reduce((sum, r) => sum + r.units, 0);
    const totalActive = meters.filter((m) => m.isActive).length;
    const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

    const childrenOf = new Map<string, string[]>();
    for (const z of zones) {
      if (z.parentZoneId && zoneById.has(z.parentZoneId)) {
        childrenOf.set(z.parentZoneId, [...(childrenOf.get(z.parentZoneId) ?? []), z.id]);
      }
    }
    // A zone's whole figure: its own meters plus every zone inside it.
    const wholeOf = (place: string): ReturnType<typeof blank> => {
      const sum = { ...at(place) };
      const inside = [...(childrenOf.get(place) ?? []), ...(hasUnplaced(place) ? [UNPLACED] : [])];
      for (const child of inside) {
        const inner = child === UNPLACED ? at(UNPLACED) : wholeOf(child);
        sum.activeMeters += inner.activeMeters;
        sum.inactiveMeters += inner.inactiveMeters;
        sum.buyingMeters += inner.buyingMeters;
        sum.units += inner.units;
        sum.revenue += inner.revenue;
      }
      return sum;
    };
    const hasUnplaced = (place: string) => place === estateId && byPlace.has(UNPLACED);
    const usageRow = (
      key: string,
      place: string,
      zoneName: string,
      depth: number,
      includesSubZones: boolean,
      z: ReturnType<typeof blank>,
    ) => ({
      key,
      zoneId: zoneById.has(place) ? place : null,
      zoneName,
      parentZoneId: zoneById.get(place)?.parentZoneId ?? null,
      depth,
      // A whole-zone row repeats the rows under it, so totals must skip it.
      includesSubZones,
      ...z,
      // No average for meters with no zone: most of their buyers are out of use.
      unitsPerMeter: key !== UNPLACED && z.activeMeters > 0 ? z.units / z.activeMeters : null,
      revenuePerMeter: key !== UNPLACED && z.activeMeters > 0 ? z.revenue / z.activeMeters : null,
      unitsSharePct: share(z.units, totalUnits),
      meterSharePct: share(z.activeMeters, totalActive),
    });
    const zoneUsage: ReturnType<typeof usageRow>[] = [];
    const byUnits = (a: string, b: string) => wholeOf(b).units - wholeOf(a).units;
    const walk = (place: string, depth: number) => {
      const children = [...(childrenOf.get(place) ?? [])].sort(byUnits);
      if (children.length === 0 && !hasUnplaced(place)) {
        zoneUsage.push(usageRow(place, place, placeName(place), depth, false, at(place)));
        return;
      }
      const name = placeName(place);
      zoneUsage.push(usageRow(`${place}:whole`, place, name, depth, true, wholeOf(place)));
      zoneUsage.push(usageRow(place, place, `${name} only`, depth + 1, false, at(place)));
      for (const child of children) walk(child, depth + 1);
      if (hasUnplaced(place)) {
        const name = placeName(UNPLACED);
        zoneUsage.push(usageRow(UNPLACED, UNPLACED, name, depth + 1, false, at(UNPLACED)));
      }
    };
    const topLevel = [...byPlace.keys()].filter((place) => {
      if (place === UNPLACED) return false;
      const parent = zoneById.get(place)?.parentZoneId;
      return !parent || !zoneById.has(parent);
    });
    for (const place of topLevel.sort(byUnits)) walk(place, 0);

    const sorted = bought.map((r) => r.units).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const typicalUnits =
      sorted.length === 0
        ? null
        : sorted.length % 2
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;

    const highUsage = [...bought]
      .sort((a, b) => b.units - a.units || b.amount - a.amount)
      .slice(0, 10)
      .map((r) => ({
        meterId: r.meter.id,
        meterNumber: r.meter.meterNumber,
        plotNo: r.meter.plotNo,
        isActive: r.meter.isActive,
        customerId: r.meter.customer?.id ?? null,
        customerName: r.meter.customer?.name ?? null,
        zoneId: r.meter.zoneId,
        zoneName: placeName(placeOf(r.meter)),
        units: r.units,
        amount: r.amount,
        purchases: r.purchases,
        timesTypical: typicalUnits && typicalUnits > 0 ? r.units / typicalUnits : null,
      }));

    const byMeter = bought.map((r) => ({
      meterId: r.meter.id,
      meterNumber: r.meter.meterNumber,
      customerName: r.meter.customer?.name ?? null,
      plotNo: r.meter.plotNo,
      units: r.units,
    }));
    return { zoneUsage, highUsage, typicalUnits, byMeter, totalUnits };
  }

  /* ---------------- One zone, opened ---------------- */

  /** Everything about one zone: what is under it, what it measures, how it did. */
  async zoneDetail(zoneId: string, month?: string) {
    const zone = await this.prisma.waterZone.findUniqueOrThrow({
      where: { id: zoneId },
      include: { parent: { select: { id: true, name: true } } },
    });
    const { start, end } = monthRange(month);
    const { ownIds } = await this.zoneTree();
    const own = inZones(ownIds(zoneId));

    const [children, meters, customers, breakdown, revenue] = await Promise.all([
      this.prisma.waterZone.findMany({
        where: { parentZoneId: zoneId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.waterMeter.findMany({
        where: { OR: [{ zoneId }, { meterType: "household", ...own }] },
        include: { customer: { select: { id: true, name: true } } },
        orderBy: [{ meterType: "asc" }, { meterNumber: "asc" }],
      }),
      this.prisma.waterCustomer.count({ where: { meters: { some: own } } }),
      this.zoneLossBreakdown(start, end),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: start, lt: end }, meter: own },
        _sum: { amountPaid: true },
      }),
    ]);
    const row = breakdown.rows.find((r) => r.zoneId === zoneId)!;
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
      ...row,
      childBulkTotal: row.childZonesBulkTotal,
      revenue: Number(revenue._sum.amountPaid ?? 0),
    };
  }

  /** Moves meters into a zone, or out to the main line when zoneId is null. */
  async assignMetersToZone(target: string | null, meterIds: string[]) {
    if (meterIds.length === 0) return { moved: 0 };
    // The main line belongs to the estate zone, when there is one.
    const zoneId = target ?? (await this.zoneTree()).estateId;
    if (target) await this.prisma.waterZone.findUniqueOrThrow({ where: { id: target } });
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
    const { zones, estateId, children, ownIds } = await this.zoneTree();
    const windows = this.periodWindows(filters.granularity, filters.periods);
    // One bulk figure per zone and window, shared by the zone and the zone above it.
    const flows = new Map<string, Awaited<ReturnType<WaterService["zoneBulkFlow"]>>[]>();
    await Promise.all(
      zones.map(async (z) => {
        flows.set(
          z.id,
          await Promise.all(windows.map((w) => this.zoneBulkFlow(z.id, w.start, w.end))),
        );
      }),
    );

    const rows = await Promise.all(
      zones.map(async (zone) => {
        const inner = children(zone.id);
        const own = { meter: inZones(ownIds(zone.id)) };
        const points = await Promise.all(
          windows.map(async (w, i) => {
            const sold = await this.prisma.waterUsageRecord.aggregate({
              where: { recordedAt: { gte: w.start, lt: w.end }, ...own },
              _sum: { unitsSold: true, amountPaid: true },
            });
            const bulk = flows.get(zone.id)![i];
            const innerBulk = inner.reduce((sum, id) => sum + flows.get(id)![i].units, 0);
            return {
              period: w.period,
              // The zone only: its bulk meter less the bulk meters inside it.
              bulkUnits: bulk.measured ? Math.max(0, bulk.units - innerBulk) : 0,
              householdUnits: Number(sold._sum.unitsSold ?? 0),
              revenue: Number(sold._sum.amountPaid ?? 0),
            };
          }),
        );
        const split = inner.length > 0 || zone.id === estateId;
        return {
          zoneId: zone.id,
          zoneName: split ? `${zone.name} only` : zone.name,
          parentZoneId: zone.parentZoneId,
          points,
        };
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

  /**
   * Each zone as two sets: the whole zone (with the zones inside it) and the zone
   * only (whole minus the inner zones). Households are counted over the same
   * dates the bulk meter was read, so both sides cover the same days.
   */
  private async zoneLossBreakdown(start: Date, end: Date) {
    const tree = await this.zoneTree();
    const { zones, roots, estateId, children, ownIds, wholeIds } = tree;
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const [flows, prevFlows, meters] = await Promise.all([
      Promise.all(zones.map((z) => this.zoneBulkFlow(z.id, start, end))),
      Promise.all(zones.map((z) => this.zoneBulkFlow(z.id, prevStart, start))),
      this.prisma.waterMeter.findMany({
        where: { meterType: "household" },
        select: { zoneId: true, isActive: true, installedAt: true, deactivatedAt: true },
      }),
    ]);
    const flowById = new Map(zones.map((z, i) => [z.id, flows[i]]));
    const prevFlowById = new Map(zones.map((z, i) => [z.id, prevFlows[i]]));
    const metersIn = (ids: (string | null)[]) =>
      meters.filter((m) => ids.includes(m.zoneId) && meterActiveIn(m, start, end)).length;

    const rows = await Promise.all(
      zones.map(async (zone) => {
        const bulk = flowById.get(zone.id)!;
        // Without two readings there is no window, so the whole period stands in.
        const from = bulk.from ?? start;
        const to = bulk.to ? new Date(bulk.to.getTime() + 1) : end;
        const inner = children(zone.id);
        const metered = inner.filter((id) => flowById.get(id)!.measured);
        const unmetered = inner.filter((id) => !flowById.get(id)!.measured);
        const hasInner = inner.length > 0 || zone.id === estateId;

        const before = prevFlowById.get(zone.id)!;
        const [own, whole, ownAdjust, wholeAdjust, boughtAgg, unmeteredUse, takenBefore] =
          await Promise.all([
            this.householdSide(from, to, ownIds(zone.id)),
            hasInner ? this.householdSide(from, to, wholeIds(zone.id)) : null,
            this.adjustmentsInPeriod(from, to, ownIds(zone.id)),
            hasInner ? this.adjustmentsInPeriod(from, to, wholeIds(zone.id)) : null,
            this.prisma.waterUsageRecord.aggregate({
              where: { recordedAt: { gte: from, lt: to }, meter: inZones(ownIds(zone.id)) },
              _sum: { unitsSold: true },
            }),
            // An inner zone with no bulk reading draws straight from this zone's pipes.
            Promise.all(unmetered.map((id) => this.householdConsumption(from, to, wholeIds(id)))),
            before.from && before.to
              ? this.householdConsumption(
                  before.from,
                  new Date(before.to.getTime() + 1),
                  ownIds(zone.id),
                )
              : null,
          ]);

        const bulkTotal = bulk.units;
        const childZonesBulkTotal = metered.reduce((sum, id) => sum + flowById.get(id)!.units, 0);
        const ownPassed = bulkTotal - childZonesBulkTotal;
        const directHouseholdTotal = own.taken;
        const wholeHouseholdTotal = (whole ?? own).taken;
        const adjustmentTotal = ownAdjust.total;
        const unmeteredTotal = unmeteredUse.reduce((sum, u) => sum + u.units, 0);
        // Known volumes are accounted for, so they never show up as unexplained.
        const ownAccounted = directHouseholdTotal + unmeteredTotal + adjustmentTotal;
        const ownAssessment = assessGap({
          measured: bulk.measured,
          passed: ownPassed,
          adjustments: adjustmentTotal + unmeteredTotal,
          household: own,
        });
        const wholeAssessment = assessGap({
          measured: bulk.measured,
          passed: bulkTotal,
          adjustments: (wholeAdjust ?? ownAdjust).total,
          household: whole ?? own,
        });
        const lossUnits = bulk.measured ? ownAssessment.gap : 0;
        const wholeLossUnits = bulk.measured ? wholeAssessment.gap : 0;

        const ownName = hasInner ? `${zone.name} only` : zone.name;
        const what =
          bulk.measured && childZonesBulkTotal > 0
            ? `${ownName} (its bulk meter less the zones inside it)`
            : `${bulk.measured ? ownName : zone.name}'s bulk meter`;
        // The same meters less the same inner zones, one period back.
        const prevOwnPassed =
          before.units - metered.reduce((sum, id) => sum + prevFlowById.get(id)!.units, 0);
        return {
          zoneId: zone.id,
          zoneName: zone.name,
          parentZoneId: zone.parentZoneId,
          isEstate: zone.id === estateId,
          hasSubZones: inner.length > 0,
          hasBulkMeter: bulk.hasMeter,
          // False when the dial was not read twice: there is no figure, not a zero.
          bulkMeasured: bulk.measured,
          bulkFrom: bulk.from,
          bulkTo: bulk.to,
          ownMeters: metersIn(ownIds(zone.id)),
          wholeMeters: metersIn(wholeIds(zone.id)),
          bulkTotal,
          childZonesBulkTotal,
          ownPassed,
          directHouseholdTotal,
          wholeHouseholdTotal,
          adjustmentTotal,
          boughtTotal: Number(boughtAgg._sum.unitsSold ?? 0),
          // "readings" is what was drawn; "tokens" is what was paid for, which may be
          // used later — so a single period on tokens is provisional.
          consumptionBasis: own.basis,
          provisional: own.basis === "tokens",
          accountedTotal: ownAccounted + childZonesBulkTotal,
          lossUnits,
          lossPct: ownAssessment.gapPct,
          wholeLossUnits,
          wholeLossPct: wholeAssessment.gapPct,
          // Whether the gap is a loss, once typical use and carried credit are allowed for.
          verdict: bulk.hasMeter ? ownAssessment.verdict : ("not_measured" as WaterVerdict),
          wholeVerdict: bulk.hasMeter ? wholeAssessment.verdict : ("not_measured" as WaterVerdict),
          expectedHouseholdTotal: own.expected,
          carriedCredit: own.carried,
          unexplainedUnits: bulk.measured ? ownAssessment.unexplained : 0,
          note: gapNote({
            brief: true,
            what,
            from: bulk.from,
            to: bulk.to,
            passed: ownPassed,
            household: own,
            assessment: ownAssessment,
          }),
          riseNote:
            bulk.from && bulk.to && before.from && before.to
              ? riseNote({
                  what: ownName,
                  now: { units: ownPassed, days: daysBetween(bulk.from, bulk.to) },
                  before: { units: prevOwnPassed, days: daysBetween(before.from, before.to) },
                  taken: own.taken,
                  takenBefore: takenBefore?.units ?? 0,
                  basis: own.basis,
                  verdict: ownAssessment.verdict,
                })
              : null,
        };
      }),
    );

    const top = rows.filter((r) => roots.includes(r.zoneId));
    const unplacedAgg = await this.prisma.waterUsageRecord.aggregate({
      where: {
        recordedAt: { gte: start, lt: end },
        meter: { zoneId: null, meterType: "household" },
      },
      _sum: { unitsSold: true },
    });
    const unplacedUnits = Number(unplacedAgg._sum.unitsSold ?? 0);

    return {
      rows,
      estateId,
      topLevelBulkTotal: top.reduce((sum, r) => sum + r.bulkTotal, 0),
      topLevelMeasured: top.some((r) => r.bulkMeasured),
      // Meters with no zone: inside the estate's whole, else loose on the main line.
      unplacedUnits,
      unplacedMeters: metersIn([null]),
      zoneLessHouseholdTotal: estateId ? 0 : unplacedUnits,
    };
  }

  async dashboard(filters: { zoneId?: string; month?: string }) {
    const { start, end } = monthRange(filters.month);
    const prevMonth = shiftMonth(filters.month, -1);
    const prevRange = monthRange(prevMonth);
    // The estate zone is everything, including meters with no zone.
    const { estateId, roots, children } = await this.zoneTree();
    const zoneIds =
      filters.zoneId && filters.zoneId !== estateId
        ? await this.zoneAndDescendantIds(filters.zoneId)
        : undefined;
    const hhWhere = this.householdWhere(zoneIds);

    const [
      activeHouseholds,
      meterStatus,
      hhAgg,
      hhPrevAgg,
      borehole,
      tankOutlet,
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
      this.mainStageFlow(MAIN_METER_BOREHOLE_TO_TANK, start, end),
      this.outletFlow(start, end),
      this.outerBulkTotal(start, end, filters.zoneId),
      this.zoneLossBreakdown(start, end),
    ]);
    const boreholeToTankTotal = borehole.units;
    const tankToDistributionTotal = tankOutlet.units;
    // The estate's own bulk meter, and the zones directly under it that never overlap.
    const firstLevel = estateId ? children(estateId) : roots;
    const zoneRow = (id: string) => zoneLoss.rows.find((r) => r.zoneId === id)!;
    const estateRow = estateId ? zoneRow(estateId) : null;
    const zoneBulk = firstLevel.map(zoneRow).filter((r) => r.hasBulkMeter);

    const statusTotals = Object.values(meterStatus);
    const activeMeters = statusTotals.reduce((sum, c) => sum + c.active, 0);
    const inactiveMeters = statusTotals.reduce((sum, c) => sum + c.inactive, 0);
    const unitsSold = Number(hhAgg._sum.unitsSold ?? 0);
    const unitsSoldPrev = Number(hhPrevAgg._sum.unitsSold ?? 0);
    const revenue = Number(hhAgg._sum.amountPaid ?? 0);
    const unitsChangePct =
      unitsSoldPrev > 0 ? ((unitsSold - unitsSoldPrev) / unitsSoldPrev) * 100 : null;

    const [consumption, adjustments, allBoughtAgg] = await Promise.all([
      this.householdConsumption(start, end),
      this.adjustmentsInPeriod(start, end),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: start, lt: end } },
        _sum: { unitsSold: true },
      }),
    ]);
    const networkAccountedTotal = zoneLoss.topLevelBulkTotal + zoneLoss.zoneLessHouseholdTotal;
    // Only with a tank outlet main meter: otherwise the estate bulk meter is the outlet.
    const nrwTankToNetwork =
      tankOutlet.source === "tank_outlet" &&
      tankOutlet.measured &&
      zoneLoss.topLevelMeasured &&
      tankToDistributionTotal > 0
        ? ((tankToDistributionTotal - networkAccountedTotal) / tankToDistributionTotal) * 100
        : null;
    const allBoughtTotal = Number(allBoughtAgg._sum.unitsSold ?? 0);
    const reconciliation = await this.reconcile(start, end, borehole, tankOutlet);
    // A loss only when water is missing. Credit bought ahead is reported by the verdict.
    const nrwOverall =
      reconciliation.verdict === "within_limit" ||
      reconciliation.verdict === "possible_loss" ||
      reconciliation.verdict === "likely_loss"
        ? reconciliation.gapPct
        : null;

    return {
      month: filters.month ?? shiftMonth(undefined, 0),
      activeHouseholds,
      activeMeters,
      inactiveMeters,
      meterStatus,
      // Bulk and main meters measure pipes, not plots, so they are never counted with these.
      householdMeters: meterStatus.household,
      unitsSold,
      unitsSoldChangePct: unitsChangePct,
      revenue,
      mainReadingTotal: boreholeToTankTotal,
      bulkReadingTotal: bulkTotal,
      bulk: {
        estate: estateRow && {
          name: estateRow.zoneName,
          units: estateRow.bulkTotal,
          measured: estateRow.bulkMeasured,
        },
        zones: {
          names: zoneBulk.map((r) => r.zoneName),
          units: zoneBulk.reduce((sum, r) => sum + r.bulkTotal, 0),
          measured: zoneBulk.some((r) => r.bulkMeasured),
        },
      },
      // Kept apart on purpose: a bulk meter measures a whole zone, a household
      // meter measures one plot. Averaging them together means nothing.
      averages: {
        perHouseholdMeter:
          meterStatus.household.active > 0 ? unitsSold / meterStatus.household.active : null,
        perBulkMeter: meterStatus.bulk.active > 0 ? bulkTotal / meterStatus.bulk.active : null,
        householdMeters: meterStatus.household.active,
        bulkMeters: meterStatus.bulk.active,
      },
      // Pumped but not yet sent out is still in the tank. It is stock, not loss.
      tank: {
        pumped: boreholeToTankTotal,
        sentOut: tankToDistributionTotal,
        outletMeasured: tankOutlet.measured,
        // "the tank outlet meter" or, without one, the estate's bulk meter.
        outletName: tankOutlet.what,
        held:
          borehole.measured && tankOutlet.measured
            ? boreholeToTankTotal - tankToDistributionTotal
            : null,
      },
      nrwTankToNetworkPct: nrwTankToNetwork,
      nrwOverallPct: nrwOverall,
      reconciliation,
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
        reconciliation,
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

    const [borehole, tankOutlet, consumption, adjustments, boughtAgg] = await Promise.all([
      this.mainStageFlow(MAIN_METER_BOREHOLE_TO_TANK, from, to),
      this.outletFlow(from, to),
      this.householdConsumption(from, to),
      this.adjustmentsInPeriod(from, to),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: from, lt: to } },
        _sum: { unitsSold: true },
      }),
    ]);
    const bought = Number(boughtAgg._sum.unitsSold ?? 0);
    // Compared over the dates the main meter was read, not the whole window.
    const reconciliation = await this.reconcile(from, to, borehole, tankOutlet);

    return {
      months,
      from,
      to,
      released: borehole.units,
      intoNetwork: tankOutlet.units,
      used: consumption.units,
      bought,
      accountedAdjustments: adjustments.total,
      adjustmentsByKind: adjustments.byKind,
      consumptionBasis: consumption.basis,
      unaccounted: reconciliation.gap,
      unaccountedPct: reconciliation.gapPct,
      reconciliation,
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
          this.outerBulkTotal(w.start, w.end, filters.zoneId),
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
    const { rows, estateId, unplacedUnits, unplacedMeters } = await this.zoneLossBreakdown(
      start,
      end,
    );
    const zoneLessHouseholdTotal = unplacedUnits;
    const zoneLessMeters = unplacedMeters;

    const mapped = rows.map((r) => ({
      ...r,
      zoneId: r.zoneId as string | null,
      householdTotal: r.directHouseholdTotal,
    }));
    // Meters with no zone get a line of their own so every set still adds up.
    if (zoneLessHouseholdTotal > 0 || zoneLessMeters > 0) {
      mapped.push({
        zoneId: null,
        zoneName: estateId ? "No zone recorded" : "On the main line",
        parentZoneId: null,
        isEstate: false,
        hasSubZones: false,
        hasBulkMeter: false,
        bulkMeasured: false,
        bulkFrom: null,
        bulkTo: null,
        ownMeters: zoneLessMeters,
        wholeMeters: zoneLessMeters,
        bulkTotal: 0,
        childZonesBulkTotal: 0,
        ownPassed: 0,
        householdTotal: zoneLessHouseholdTotal,
        directHouseholdTotal: zoneLessHouseholdTotal,
        wholeHouseholdTotal: zoneLessHouseholdTotal,
        accountedTotal: zoneLessHouseholdTotal,
        adjustmentTotal: 0,
        boughtTotal: zoneLessHouseholdTotal,
        consumptionBasis: "tokens" as const,
        provisional: true,
        lossUnits: 0,
        lossPct: null,
        wholeLossUnits: 0,
        wholeLossPct: null,
        verdict: "not_measured",
        wholeVerdict: "not_measured",
        expectedHouseholdTotal: null,
        carriedCredit: 0,
        unexplainedUnits: 0,
        note: "",
        riseNote: null,
      });
    }
    return mapped;
  }

  async reportSummary(filters: { month?: string }) {
    const month = filters.month ?? shiftMonth(undefined, 0);
    const prevMonth = shiftMonth(month, -1);
    const { start, end } = monthRange(month);
    const prevRange = monthRange(prevMonth);
    const [dashboard, prevDashboard, zoneStats, usage, prevUsage] = await Promise.all([
      this.dashboard({ month }),
      this.dashboard({ month: prevMonth }),
      this.zoneComparison({ month }),
      this.householdUsageBreakdown(start, end),
      this.householdUsageBreakdown(prevRange.start, prevRange.end),
    ]);
    const units = wholeUnits;
    const zoneLoss = [...zoneStats].sort(
      (a, b) => (b.lossPct ?? -Infinity) - (a.lossPct ?? -Infinity),
    );
    const insights: string[] = [];

    // 1. The network as a whole: released against what households took, same dates.
    const { reconciliation, tank } = dashboard;
    if (reconciliation.released > 0 || reconciliation.householdUnits > 0) {
      insights.push(reconciliation.note);
    }
    if (reconciliation.riseNote) insights.push(reconciliation.riseNote);
    if (reconciliation.basis === "tokens" && reconciliation.measured) {
      insights.push(
        "Household figures are water paid for, because household meter balances were not read. A gap is only called a likely loss when typical use and credit left from earlier purchases cannot explain it; until balances are read, one month's figures are provisional.",
      );
    }
    if (tank.held !== null) {
      const stock =
        tank.held >= 0
          ? `${units(tank.held)} m³ is still in the tank`
          : `${units(-tank.held)} m³ came from water already stored in the tank`;
      insights.push(
        `${units(tank.pumped)} m³ was pumped into the tank and ${units(tank.sentOut)} m³ left it, so ${stock}. Water in the tank is stock, not loss.`,
      );
    } else if (tank.pumped > 0 && !tank.outletMeasured) {
      insights.push(
        `${units(tank.pumped)} m³ was pumped into the tank. ${tank.outletName.charAt(0).toUpperCase()}${tank.outletName.slice(1)} was not read twice this month, so what left the tank is not known yet.`,
      );
    }

    // 2. Each zone on its own: the zone only, without the zones inside it.
    const zoneNotes = zoneStats.filter((z) => z.zoneId !== null && z.hasBulkMeter);
    const byVerdict = (v: WaterVerdict) => zoneNotes.filter((z) => z.verdict === v);
    const worstFirst = (a: { unexplainedUnits: number }, b: typeof a) =>
      b.unexplainedUnits - a.unexplainedUnits;
    for (const z of byVerdict("likely_loss").sort(worstFirst)) {
      insights.push(z.note);
      if (z.riseNote) insights.push(z.riseNote);
    }
    for (const z of byVerdict("over_read")) insights.push(z.note);
    for (const z of byVerdict("possible_loss")) {
      insights.push(z.note);
      if (z.riseNote) insights.push(z.riseNote);
    }
    for (const z of byVerdict("bought_ahead")) insights.push(z.note);
    for (const z of byVerdict("not_measured")) insights.push(z.note);

    // 3. Why household water went up or down against the month before.
    if (prevUsage.totalUnits > 0 && usage.totalUnits > 0) {
      const changePct = ((usage.totalUnits - prevUsage.totalUnits) / prevUsage.totalUnits) * 100;
      const reasons: string[] = [];
      if (usage.byMeter.length !== prevUsage.byMeter.length) {
        reasons.push(
          `${plural(usage.byMeter.length, "meter")} bought water against ${prevUsage.byMeter.length} the month before`,
        );
      }
      const prevByZone = new Map(prevUsage.zoneUsage.map((z) => [z.key, z.units]));
      const zoneMove = usage.zoneUsage
        .filter((z) => !z.includesSubZones)
        .map((z) => ({ name: z.zoneName, change: z.units - (prevByZone.get(z.key) ?? 0) }))
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
      if (zoneMove && Math.abs(zoneMove.change) >= 1) {
        reasons.push(
          `the biggest change was ${zoneMove.name}, ${zoneMove.change > 0 ? "up" : "down"} ${units(Math.abs(zoneMove.change))} m³`,
        );
      }
      const because = reasons.length > 0 ? `: ${reasons.join("; ")}` : "";
      insights.push(
        Math.abs(changePct) < 0.5
          ? `Households paid for ${units(usage.totalUnits)} m³, about the same as the month before.`
          : `Households paid for ${units(usage.totalUnits)} m³, ${Math.abs(changePct).toFixed(1)}% ${changePct > 0 ? "more" : "less"} than the month before (${units(prevUsage.totalUnits)} m³)${because}.`,
      );

      // A meter that at least doubled, by a volume worth a visit.
      const prevByMeter = new Map(prevUsage.byMeter.map((m) => [m.meterId, m.units]));
      const jump = usage.byMeter
        .map((m) => ({ ...m, before: prevByMeter.get(m.meterId) ?? 0 }))
        .filter((m) => m.units >= 2 * m.before && m.units - m.before >= 10)
        .sort((a, b) => b.units - b.before - (a.units - a.before))[0];
      if (jump) {
        const who = [jump.customerName, jump.plotNo && `plot ${jump.plotNo}`]
          .filter(Boolean)
          .join(", ");
        insights.push(
          `Meter ${jump.meterNumber}${who ? ` (${who})` : ""} rose the most: ${units(jump.units)} m³ against ${jump.before > 0 ? `${units(jump.before)} m³` : "nothing"} the month before. A sudden rise can be a leak after the meter, a shared connection or stocking up.`,
        );
      }
    }

    const unplaced = usage.zoneUsage.find((z) => z.key === "unplaced");
    if (unplaced && unplaced.units > 0) {
      insights.push(
        `${plural(unplaced.buyingMeters, "meter")} with no zone recorded bought ${units(unplaced.units)} m³ (KES ${units(unplaced.revenue)}). A meter with no zone in the register is treated as out of use, so check whether these are still connected and where.`,
      );
    }

    // 4. Who uses the most.
    const zonesWithUse = usage.zoneUsage.filter((z) => !z.includesSubZones && z.units > 0);
    const busiestZone = zonesWithUse
      .filter((z) => z.unitsPerMeter !== null)
      .sort((a, b) => b.unitsPerMeter! - a.unitsPerMeter!)[0];
    if (busiestZone && zonesWithUse.length > 1) {
      insights.push(
        `${busiestZone.zoneName} used the most water per meter: ${busiestZone.unitsPerMeter!.toFixed(1)} m³ and KES ${units(busiestZone.revenuePerMeter!)} per meter across ${plural(busiestZone.activeMeters, "meter")} in use.`,
      );
    }
    const topUser = usage.highUsage[0];
    if (topUser && topUser.units > 0) {
      const who = topUser.customerName ? ` (${topUser.customerName})` : "";
      const against =
        topUser.timesTypical !== null && topUser.timesTypical >= 2
          ? `, ${topUser.timesTypical.toFixed(1)} times the typical household`
          : "";
      insights.push(
        `Meter ${topUser.meterNumber}${who} bought the most water: ${units(topUser.units)} m³ for KES ${units(topUser.amount)}${against}.`,
      );
    }
    if (dashboard.nrwTankToNetworkPct !== null) {
      const p = dashboard.nrwTankToNetworkPct;
      insights.push(
        p >= 0
          ? `${p.toFixed(1)}% of the water leaving the tank did not reach the first bulk meter.`
          : `The first bulk meter passed ${Math.abs(p).toFixed(1)}% more than the tank outlet meter. They sit on the same pipe, so one of them is misreading or was read on different days.`,
      );
    }
    if (dashboard.householdMeters.inactive > 0) {
      insights.push(
        `${dashboard.householdMeters.active} household meters are in use and ${dashboard.householdMeters.inactive} are out of use. Meters out of use still count in the months they were working.`,
      );
    }

    return {
      month,
      dashboard,
      prevDashboard,
      zoneLoss,
      insights,
      zoneUsage: usage.zoneUsage,
      highUsage: usage.highUsage,
      typicalHouseholdUnits: usage.typicalUnits,
    };
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
