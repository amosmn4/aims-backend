import { BadRequestException, Injectable } from "@nestjs/common";
import type { WaterMeterType } from "@prisma/client";
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

  private async findOrCreateCustomerByName(name: string, zoneId?: string) {
    const existing = await this.prisma.waterCustomer.findFirst({ where: { name } });
    if (existing) return existing;
    return this.prisma.waterCustomer.create({ data: { name, zoneId } });
  }

  /* ---------- Meters — the primary registration entry point ---------- */

  findAllMeters(
    filters: { meterType?: WaterMeterType; zoneId?: string; q?: string },
    pagination: PaginationQueryDto = {},
  ) {
    return maybePaginate(
      this.prisma.waterMeter,
      {
        where: {
          ...(filters.meterType && { meterType: filters.meterType }),
          ...(filters.zoneId && { zoneId: filters.zoneId }),
          ...(filters.q && { meterNumber: { contains: filters.q } }),
        },
        include: { customer: { select: { id: true, name: true } }, zone: true },
        orderBy: { meterNumber: "asc" },
      },
      pagination,
    );
  }

  async createMeter(dto: CreateMeterDto) {
    const customerId = await this.resolveCustomerId(dto.customerId, dto.customerName, dto.zoneId);
    return this.prisma.waterMeter.create({
      data: {
        meterNumber: dto.meterNumber,
        meterType: dto.meterType ?? "household",
        customerId,
        plotNo: dto.plotNo,
        installedAt: dto.installedAt ? new Date(dto.installedAt) : undefined,
        zoneId: dto.zoneId,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateMeter(id: string, dto: UpdateMeterDto) {
    await this.prisma.waterMeter.findUniqueOrThrow({ where: { id } });
    const customerId = await this.resolveCustomerId(dto.customerId, dto.customerName, dto.zoneId);
    return this.prisma.waterMeter.update({
      where: { id },
      data: {
        meterNumber: dto.meterNumber,
        meterType: dto.meterType,
        ...(customerId !== undefined && { customerId }),
        plotNo: dto.plotNo,
        ...(dto.installedAt !== undefined && {
          installedAt: dto.installedAt ? new Date(dto.installedAt) : null,
        }),
        zoneId: dto.zoneId,
        isActive: dto.isActive,
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
  async createUpload(dto: CreateUsageUploadDto, user: AuthenticatedUser) {
    const upload = await this.prisma.waterUsageUpload.create({
      data: { fileName: dto.fileName, uploadedBy: user.id, recordCount: dto.rows.length },
    });

    for (const row of dto.rows) {
      const meter = await this.findOrCreateMeterWithCustomer(row.meterNumber, row.customerName);
      await this.prisma.waterUsageRecord.create({
        data: {
          meterId: meter.id,
          customerId: meter.customerId,
          customerName: row.customerName,
          unitsSold: row.unitsSold,
          amountPaid: row.amountPaid,
          recordedAt: new Date(row.recordedAt),
          source: "upload",
          uploadId: upload.id,
        },
      });
    }
    return this.prisma.waterUsageUpload.findUniqueOrThrow({
      where: { id: upload.id },
      include: { _count: { select: { records: true } } },
    });
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

  private async readingTotalForType(
    type: WaterMeterType,
    start: Date,
    end: Date,
    zoneId?: string,
  ): Promise<number> {
    const readings = await this.prisma.waterMeterReading.findMany({
      where: {
        readingDate: { gte: start, lt: end },
        meter: { meterType: type, ...(zoneId && { zoneId }) },
      },
      orderBy: { readingDate: "desc" },
      select: { meterId: true, value: true },
    });
    const latestByMeter = new Map<string, number>();
    for (const r of readings) {
      if (!latestByMeter.has(r.meterId)) latestByMeter.set(r.meterId, Number(r.value));
    }
    return [...latestByMeter.values()].reduce((s, v) => s + v, 0);
  }

  // A "zone" filter matches a household meter/customer directly assigned to that exact zone —
  // since sub-zones are just zones with a parent, filtering by a sub-zone's id already narrows
  // precisely without needing a second dimension.
  private householdWhere(zoneId?: string) {
    return zoneId ? { meter: { zoneId } } : {};
  }

  async dashboard(filters: { zoneId?: string; month?: string }) {
    const { start, end } = monthRange(filters.month);
    const prevMonth = shiftMonth(filters.month, -1);
    const prevRange = monthRange(prevMonth);
    const hhWhere = this.householdWhere(filters.zoneId);

    const [activeHouseholds, hhAgg, hhPrevAgg, mainTotal, bulkTotal] = await Promise.all([
      this.prisma.waterCustomer.count({
        where: { isActive: true, ...(filters.zoneId && { zoneId: filters.zoneId }) },
      }),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: start, lt: end }, ...hhWhere },
        _sum: { unitsSold: true, amountPaid: true },
      }),
      this.prisma.waterUsageRecord.aggregate({
        where: { recordedAt: { gte: prevRange.start, lt: prevRange.end }, ...hhWhere },
        _sum: { unitsSold: true },
      }),
      this.readingTotalForType("main", start, end),
      this.readingTotalForType("bulk", start, end, filters.zoneId),
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
    const hhWhere = this.householdWhere(filters.zoneId);
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
          this.readingTotalForType("main", start, end),
          this.readingTotalForType("bulk", start, end, filters.zoneId),
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
        const [bulkTotal, hhAgg] = await Promise.all([
          this.readingTotalForType("bulk", start, end, zone.id),
          this.prisma.waterUsageRecord.aggregate({
            where: { recordedAt: { gte: start, lt: end }, meter: { zoneId: zone.id } },
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
    const [dashboard, zoneStats] = await Promise.all([
      this.dashboard({ month }),
      this.zoneComparison({ month }),
    ]);

    const zoneLoss = zoneStats.map((z) => ({
      zoneId: z.zoneId,
      zoneName: z.zoneName,
      lossPct: z.bulkTotal > 0 ? ((z.bulkTotal - z.householdTotal) / z.bulkTotal) * 100 : null,
    }));
    const worstZone = [...zoneLoss]
      .filter((z) => z.lossPct !== null)
      .sort((a, b) => (b.lossPct ?? 0) - (a.lossPct ?? 0))[0];

    const insights: string[] = [];
    if (worstZone) {
      insights.push(
        `${worstZone.zoneName} recorded the highest bulk-to-household loss this period at ${worstZone.lossPct!.toFixed(1)}%.`,
      );
    }
    if (dashboard.nrwMainToHouseholdPct !== null) {
      insights.push(
        `Non-revenue water between the main meter and billed household consumption sits at ${dashboard.nrwMainToHouseholdPct.toFixed(1)}%.`,
      );
    }
    if (dashboard.unitsSoldChangePct !== null) {
      insights.push(
        `Metered household consumption ${dashboard.unitsSoldChangePct >= 0 ? "grew" : "fell"} ${Math.abs(dashboard.unitsSoldChangePct).toFixed(1)}% month-on-month.`,
      );
    }

    return { month, dashboard, zoneLoss, insights };
  }
}
