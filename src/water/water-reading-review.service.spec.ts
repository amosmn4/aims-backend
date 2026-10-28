import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { WaterReadingReviewService } from "./water-reading-review.service";

const user: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["water"],
  departmentId: null,
};
const dto = { meterId: "bulk", readingDate: "2026-01-10T09:00:00Z", value: 21500 };

function fixture() {
  const observations = [
    {
      id: "previous",
      readingDate: new Date("2026-01-09T09:00:00Z"),
      value: 22000,
      cumulativeUsage: null,
    },
  ];
  const db = {
    waterMeter: {
      findUnique: jest.fn(async () => ({
        id: "bulk",
        meterNumber: "B-01",
        meterType: "bulk",
        isActive: true,
        installedAt: null,
      })),
    },
    waterMeterReading: {
      findUnique: jest.fn(async () => ({ meterId: "bulk" })),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async ({ where }: { where: { readingDate: { lt?: Date; gt?: Date } } }) =>
        observations.filter((row) =>
          where.readingDate.lt
            ? row.readingDate < where.readingDate.lt
            : row.readingDate > where.readingDate.gt!,
        ),
      ),
      create: jest.fn(async ({ data }: { data: unknown }) => ({
        id: "new-reading",
        ...(data as object),
      })),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  const service = new WaterReadingReviewService(
    db as unknown as PrismaService,
    new ConfigService({ JWT_ACCESS_SECRET: "test-only-reading-secret" }),
  );
  return { db, service, observations };
}

describe("Reading confirmation enforcement", () => {
  it("preserves review and editing of existing history on inactive meters", async () => {
    const { service, db } = fixture();
    db.waterMeter.findUnique.mockResolvedValue({
      id: "bulk",
      meterNumber: "B-01",
      meterType: "bulk",
      isActive: false,
      installedAt: null,
    });
    await expect(
      service.assess({ ...dto, value: 22100 }, user.id, undefined, "historical-reading"),
    ).resolves.toMatchObject({ warnings: [] });
  });

  it("continues to block new readings on inactive meters", async () => {
    const { service, db } = fixture();
    db.waterMeter.findUnique.mockResolvedValue({
      id: "bulk",
      meterNumber: "B-01",
      meterType: "bulk",
      isActive: false,
      installedAt: null,
    });
    await expect(service.create({ ...dto, value: 22100 }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("rejects a suspicious write until explicitly confirmed", async () => {
    const { service, db } = fixture();
    await expect(service.create(dto, user)).rejects.toBeInstanceOf(ConflictException);
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("records the confirmed warning, reason, and actor", async () => {
    const { service, db } = fixture();
    const review = await service.assess(dto, user.id);
    await service.create(
      {
        ...dto,
        reviewToken: review.reviewToken,
        reviewReason: "Checked the physical dial and confirmed its rollover",
      },
      user,
    );
    expect(db.waterMeterReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        value: 21500,
        review: expect.objectContaining({
          confirmedBy: user.id,
          reason: expect.stringContaining("rollover"),
          warnings: expect.arrayContaining([
            expect.objectContaining({ code: "counter_decreased" }),
          ]),
        }),
      }),
    });
  });

  it("rejects a token reused for a different proposed value", async () => {
    const { service, db } = fixture();
    const review = await service.assess(dto, user.id);
    await expect(
      service.create(
        {
          ...dto,
          value: 21000,
          reviewToken: review.reviewToken,
          reviewReason: "Verified this number",
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("requires a fresh review when meter history changes", async () => {
    const { service, observations, db } = fixture();
    const review = await service.assess(dto, user.id);
    observations[0].value = 23000;
    await expect(
      service.create(
        { ...dto, reviewToken: review.reviewToken, reviewReason: "Verified this number" },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("does not accept another user's confirmation token", async () => {
    const { service } = fixture();
    const review = await service.assess(dto, "another-user");
    await expect(
      service.create(
        { ...dto, reviewToken: review.reviewToken, reviewReason: "Verified this number" },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not require an override for a normal increasing reading", async () => {
    const { service, db } = fixture();
    await expect(service.create({ ...dto, value: 22100 }, user)).resolves.toMatchObject({
      value: 22100,
    });
    expect(db.waterMeterReading.create).toHaveBeenCalledTimes(1);
  });
});
