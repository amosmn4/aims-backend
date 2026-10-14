import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { WaterService } from "./water.service";
import type { WaterExpensesService } from "./water-expenses.service";
import { CreateReadingDto } from "./dto/create-reading.dto";

const start = new Date("2026-09-30T21:00:00Z");
const end = new Date("2026-10-31T21:00:00Z");
const staff: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["water"],
  departmentId: null,
};

function fixture() {
  const meters = Array.from({ length: 10 }, (_, index) => ({
    id: `meter-${index}`,
    meterType: "household",
    meterNumber: `00${index}`,
    isActive: true,
    installedAt: null,
    deactivatedAt: null,
    replacedByMeter: null,
  }));
  const readings = meters.flatMap((meter, index) => [
    {
      id: `opening-${index}`,
      meterId: meter.id,
      readingDate: start,
      value: 0,
      cumulativeUsage: 519 + index,
      notes: null,
    },
    {
      id: `closing-${index}`,
      meterId: meter.id,
      readingDate: end,
      value: 2,
      cumulativeUsage: 522 + index,
      notes: null,
    },
  ]);
  const purchases = meters.map((meter) => ({
    meterId: meter.id,
    recordedAt: new Date("2026-10-15T00:00:00Z"),
    unitsSold: 5,
  }));
  const prisma = {
    waterMeter: {
      findMany: jest.fn(async (_query: unknown) => meters),
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string } }) =>
          meters.find((meter) => meter.id === where.id) ?? null,
      ),
      findUniqueOrThrow: jest.fn(async () => meters[0]),
      update: jest.fn(async (_query: unknown) => meters[0]),
      create: jest.fn(async (_query: unknown) => ({ ...meters[0], id: "new-meter" })),
    },
    waterMeterReading: {
      findMany: jest.fn(async (_query: unknown) => readings),
      findFirst: jest.fn(async () => null),
      findUniqueOrThrow: jest.fn(async () => readings[1]),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      update: jest.fn(async ({ data }: { data: unknown; where: { id: string } }) => data),
    },
    waterUsageRecord: {
      findMany: jest.fn(async () => purchases),
      aggregate: jest.fn(
        async ({ where }: { where: { AND?: { OR: { meterId: { notIn: string[] } }[] }[] } }) => {
          const excluded = where.AND?.[0]?.OR[0]?.meterId.notIn ?? [];
          const fallback = purchases.filter((purchase) => !excluded.includes(purchase.meterId));
          return {
            _sum: { unitsSold: fallback.reduce((sum, row) => sum + row.unitsSold, 0) },
            _count: { _all: fallback.length },
          };
        },
      ),
    },
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
  };
  return {
    prisma,
    meters,
    readings,
    service: new WaterService(prisma as unknown as PrismaService, {} as WaterExpensesService),
  };
}

describe("Household reconciliation API", () => {
  it("reconciles ten households buying fifty units, using thirty and retaining twenty", async () => {
    const { service } = fixture();
    const result = await service.householdReconciliation("2026-10");
    expect(result).toMatchObject({
      units: 30,
      basis: "readings",
      metersRead: 10,
      reconciliation: {
        metersRead: 10,
        metersTotal: 10,
        counterMetersRead: 10,
        complete: true,
        estimated: false,
        openingBalance: 0,
        purchases: 50,
        closingBalance: 20,
        measuredUsed: 30,
        creditUsed: 30,
        difference: 0,
      },
    });
  });

  it("does not declare partial household coverage settled or sum lifetime totals as consumption", async () => {
    const { service, readings } = fixture();
    readings.splice(
      readings.findIndex((reading) => reading.id === "closing-9"),
      1,
    );
    const result = await service.householdReconciliation("2026-10");
    expect(result).toMatchObject({
      units: 32,
      basis: "mixed",
      reconciliation: {
        metersRead: 9,
        metersTotal: 10,
        complete: false,
        measuredUsed: 27,
        closingBalance: 18,
      },
    });
  });

  it("keeps existing remaining balances meaningful when lifetime counters were never captured", async () => {
    const { readings } = fixture();
    const legacy = readings.map((reading) => ({ ...reading, cumulativeUsage: null }));
    const { prisma } = fixture();
    prisma.waterMeterReading.findMany.mockResolvedValue(legacy as unknown as typeof readings);
    const older = new WaterService(prisma as unknown as PrismaService, {} as WaterExpensesService);
    expect((await older.householdReconciliation("2026-10")).reconciliation).toMatchObject({
      measuredUsed: null,
      creditUsed: 30,
      closingBalance: 20,
      difference: null,
    });
  });

  it("uses Nairobi month boundaries and rejects invalid month filters", async () => {
    const { service, prisma } = fixture();
    await service.householdReconciliation("2026-10");
    const query = prisma.waterUsageRecord.aggregate.mock.calls[0][0] as unknown as {
      where: { recordedAt: { gte: Date; lt: Date } };
    };
    expect(query.where.recordedAt).toEqual({
      gte: new Date("2026-09-30T21:00:00Z"),
      lt: new Date("2026-10-31T21:00:00Z"),
    });
    await expect(service.householdReconciliation("2026-13")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("includes midnight captures when filtering household readings by Nairobi calendar dates", async () => {
    const { service, prisma } = fixture();
    await service.listReadings({ meterType: "household", from: "2026-10-01", to: "2026-10-31" });
    expect(prisma.waterMeterReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          readingDate: {
            gte: new Date("2026-09-30T21:00:00Z"),
            lte: new Date("2026-10-31T20:59:59.999Z"),
          },
        }),
      }),
    );
  });

  it("stores remaining units and lifetime usage as separate values on create and edit", async () => {
    const { service, prisma } = fixture();
    await service.createReading(
      { meterId: "meter-0", readingDate: end.toISOString(), value: 20, cumulativeUsage: 549 },
      staff,
    );
    expect(prisma.waterMeterReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ value: 20, cumulativeUsage: 549, createdBy: "staff" }),
    });
    await service.updateReading("closing-0", { value: 4, cumulativeUsage: 525 });
    expect(prisma.waterMeterReading.update).toHaveBeenCalledWith({
      where: { id: "closing-0" },
      data: expect.objectContaining({ value: 4, cumulativeUsage: 525 }),
    });
  });

  it("prevents household counter metadata being attached to a main or bulk reading", async () => {
    const { service, meters, prisma } = fixture();
    meters[0].meterType = "main";
    await expect(
      service.createReading(
        { meterId: "meter-0", readingDate: end.toISOString(), value: 20, cumulativeUsage: 549 },
        staff,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("keeps the ending and starting counter readings on separate meters during replacement", async () => {
    const { service, prisma } = fixture();
    await service.takeMeterOutOfUse(
      "meter-0",
      {
        reason: "replaced",
        date: end.toISOString(),
        finalReading: 20,
        finalCumulativeUsage: 549,
        newMeterNumber: "NEW-001",
        newMeterReading: 20,
        newMeterCumulativeUsage: 0,
      },
      staff,
    );
    expect(prisma.waterMeterReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ meterId: "meter-0", value: 20, cumulativeUsage: 549 }),
    });
    expect(prisma.waterMeterReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ meterId: "new-meter", value: 20, cumulativeUsage: 0 }),
    });
  });

  it("validates the new counter and leaves old credit-only payloads compatible", async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const dto = { meterId: "meter-0", readingDate: end.toISOString(), value: 20 };
    const metadata = { type: "body" as const, metatype: CreateReadingDto };
    await expect(pipe.transform(dto, metadata)).resolves.toBeDefined();
    await expect(pipe.transform({ ...dto, cumulativeUsage: 0 }, metadata)).resolves.toBeDefined();
    for (const cumulativeUsage of [-1, 519.123, "519", Infinity])
      await expect(pipe.transform({ ...dto, cumulativeUsage }, metadata)).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });
});
