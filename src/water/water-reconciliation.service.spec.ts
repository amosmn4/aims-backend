import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { WaterService } from "./water.service";
import type { WaterExpensesService } from "./water-expenses.service";
import { CreateReadingDto } from "./dto/create-reading.dto";
import { ConfigService } from "@nestjs/config";
import { WaterReadingReviewService } from "./water-reading-review.service";

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
  const intervals: { meterId: string; periodStart: Date; periodEnd: Date; units: number }[] = [];
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
      findMany: jest.fn(async (query: unknown) => {
        const { where } = query as {
          where?: {
            meterId?: string;
            id?: { not?: string };
            readingDate?: { lt?: Date; gt?: Date };
          };
        };
        return readings.filter(
          (row) =>
            (!where?.meterId || row.meterId === where.meterId) &&
            (!where?.id?.not || row.id !== where.id.not) &&
            (!where?.readingDate?.lt || row.readingDate < where.readingDate.lt) &&
            (!where?.readingDate?.gt || row.readingDate > where.readingDate.gt),
        );
      }),
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
    waterMeterUsageInterval: { findMany: jest.fn(async () => intervals) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
  };
  const readingReview = new WaterReadingReviewService(
    prisma as unknown as PrismaService,
    new ConfigService({ JWT_ACCESS_SECRET: "test-only-reading-secret" }),
  );
  return {
    prisma,
    meters,
    readings,
    intervals,
    readingReview,
    service: new WaterService(
      prisma as unknown as PrismaService,
      {} as WaterExpensesService,
      readingReview,
    ),
  };
}

describe("Household reconciliation API", () => {
  it.each([false, true])(
    "checks the readings inside a bulk period for a reset (reset: %s)",
    async (reset) => {
      const { service, prisma } = fixture();
      const closing = new Date(+end - 1);
      const history = [
        { readingDate: start, value: 22000 },
        { readingDate: new Date("2026-10-15T00:00:00Z"), value: reset ? 21500 : 22005 },
        { readingDate: closing, value: 22010 },
      ];
      prisma.waterMeterReading.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(history[0] as never)
        .mockResolvedValueOnce(history[2] as never)
        .mockResolvedValueOnce(null);
      prisma.waterMeterReading.findMany.mockResolvedValueOnce(history as never);
      const meterFlow = (
        service as unknown as {
          meterFlow: (id: string, start: Date, end: Date) => Promise<unknown>;
        }
      ).meterFlow.bind(service);
      expect(await meterFlow("bulk-meter", start, end)).toEqual(
        reset ? null : { units: 10, from: start, to: closing },
      );
    },
  );

  it("includes recorded purchases for interval-only households and distinguishes their counter coverage", async () => {
    const { service, readings, meters, intervals } = fixture();
    readings.splice(0, 2);
    intervals.push({ meterId: meters[0].id, periodStart: start, periodEnd: end, units: 3 });
    expect((await service.householdReconciliation("2026-10")).reconciliation).toMatchObject({
      purchases: 50,
      measuredUsed: 30,
      counterMetersRead: 9,
      openingBalance: null,
      closingBalance: null,
      creditUsed: null,
    });
  });

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
    const older = new WaterService(
      prisma as unknown as PrismaService,
      {} as WaterExpensesService,
      new WaterReadingReviewService(
        prisma as unknown as PrismaService,
        new ConfigService({ JWT_ACCESS_SECRET: "test-only-reading-secret" }),
      ),
    );
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
    const { service, prisma, readingReview } = fixture();
    const input = {
      meterId: "meter-0",
      readingDate: end.toISOString(),
      value: 20,
      cumulativeUsage: 549,
    };
    const review = await readingReview.assess(input, staff.id);
    await service.createReading(
      {
        ...input,
        reviewToken: review.reviewToken,
        reviewReason: "Verified the figures against the meter",
      },
      staff,
    );
    expect(prisma.waterMeterReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ value: 20, cumulativeUsage: 549, createdBy: "staff" }),
    });
    const edited = { ...input, value: 4, cumulativeUsage: 525 };
    const editedReview = await readingReview.assess(edited, staff.id, undefined, "closing-0");
    await service.updateReading(
      "closing-0",
      {
        value: 4,
        cumulativeUsage: 525,
        reviewToken: editedReview.reviewToken,
        reviewReason: "Verified the corrected figures on the meter",
      },
      staff,
    );
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
