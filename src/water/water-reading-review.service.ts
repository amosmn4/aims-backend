import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateReadingDto } from "./dto/create-reading.dto";
import type { UpdateReadingDto } from "./dto/update-reading.dto";
import { assessReading, type ReadingObservation, type ReadingWarning } from "./reading-assessment";

export type WaterDatabase = PrismaService | Prisma.TransactionClient;
export interface ReadingReview {
  warnings: ReadingWarning[];
  reviewToken: string;
  meter: { id: string; meterNumber: string; meterType: string };
}

@Injectable()
export class WaterReadingReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async assess(
    dto: CreateReadingDto,
    userId: string,
    db: WaterDatabase = this.prisma,
    excludeId?: string,
    staged: ReadingObservation[] = [],
  ): Promise<ReadingReview> {
    const at = new Date(dto.readingDate);
    if (!Number.isFinite(+at))
      throw new BadRequestException("Enter a valid reading date and time.");
    const meter = await db.waterMeter.findUnique({ where: { id: dto.meterId } });
    if (!meter) throw new BadRequestException("Meter not found. Select a registered meter.");
    if (!meter.isActive) {
      const original = excludeId
        ? await db.waterMeterReading.findUnique({
            where: { id: excludeId },
            select: { meterId: true },
          })
        : null;
      if (original?.meterId !== meter.id)
        throw new BadRequestException(
          `Meter ${meter.meterNumber} is inactive. Confirm its status before adding readings.`,
        );
    }
    const value = dto.value ?? null;
    const cumulativeUsage = dto.cumulativeUsage ?? null;
    for (const number of [value, cumulativeUsage]) {
      if (
        number !== null &&
        (!Number.isFinite(number) ||
          number < 0 ||
          number > 999999999999.99 ||
          Math.abs(number * 100 - Math.round(number * 100)) > 0.00001)
      )
        throw new BadRequestException(
          "Reading values must be nonnegative with at most two decimal places.",
        );
    }
    if (meter.meterType !== "household" && value === null)
      throw new BadRequestException("Main and bulk meters require a dial reading.");
    if (meter.meterType !== "household" && cumulativeUsage !== null)
      throw new BadRequestException("Cumulative household usage belongs only to household meters");
    if (value === null && cumulativeUsage === null)
      throw new BadRequestException("Supply a balance, a lifetime usage counter, or both.");
    const base = { meterId: dto.meterId, ...(excludeId && { id: { not: excludeId } }) };
    const [clash, earlier, later] = await Promise.all([
      db.waterMeterReading.findFirst({ where: { ...base, readingDate: at }, select: { id: true } }),
      db.waterMeterReading.findMany({
        where: {
          ...base,
          readingDate: { lt: at },
          ...(meter.meterType === "household" &&
            cumulativeUsage !== null && { cumulativeUsage: { not: null } }),
        },
        orderBy: { readingDate: "desc" },
        take: 30,
      }),
      db.waterMeterReading.findMany({
        where: {
          ...base,
          readingDate: { gt: at },
          ...(meter.meterType === "household" &&
            cumulativeUsage !== null && { cumulativeUsage: { not: null } }),
        },
        orderBy: { readingDate: "asc" },
        take: 30,
      }),
    ]);
    if (clash)
      throw new ConflictException("This meter already has a reading at that date and time.");
    const observations: ReadingObservation[] = [...earlier, ...later].map((r) => ({
      id: r.id,
      readingDate: r.readingDate,
      value: r.value === null ? null : Number(r.value),
      cumulativeUsage: r.cumulativeUsage === null ? null : Number(r.cumulativeUsage),
    }));
    if (meter.meterType === "household") {
      const balances = await db.waterMeterReading.findMany({
        where: { ...base, value: { not: null }, readingDate: { lt: at } },
        orderBy: { readingDate: "desc" },
        take: 1,
      });
      for (const reading of balances)
        if (!observations.some((row) => row.id === reading.id))
          observations.push({
            id: reading.id,
            readingDate: reading.readingDate,
            value: reading.value === null ? null : Number(reading.value),
            cumulativeUsage:
              reading.cumulativeUsage === null ? null : Number(reading.cumulativeUsage),
          });
    }
    for (const row of staged)
      if (
        +row.readingDate !== +at &&
        !observations.some((r) => +r.readingDate === +row.readingDate)
      )
        observations.push(row);
    const previousBalance = observations
      .filter((r) => r.readingDate < at && r.value !== null)
      .sort((a, b) => +b.readingDate - +a.readingDate)[0];
    const purchases =
      meter.meterType === "household" && previousBalance
        ? await db.waterUsageRecord.aggregate({
            where: {
              meterId: dto.meterId,
              recordedAt: { gt: previousBalance.readingDate, lte: at },
            },
            _sum: { unitsSold: true },
          })
        : null;
    const purchasedUnits = Number(purchases?._sum.unitsSold ?? 0);
    const warnings = assessReading({
      meterType: meter.meterType,
      readingDate: at,
      value,
      cumulativeUsage,
      observations,
      purchasedUnits,
    });
    if (meter.installedAt && at < meter.installedAt)
      warnings.push({
        code: "before_installation",
        severity: "danger",
        message:
          "This reading predates this meter's installation. Check the date and whether it belongs to the replaced meter.",
      });
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          userId,
          meter: { id: meter.id, isActive: meter.isActive, installedAt: meter.installedAt },
          at,
          value,
          cumulativeUsage,
          observations: observations
            .sort((a, b) => +a.readingDate - +b.readingDate)
            .map(({ readingDate, value, cumulativeUsage }) => ({
              readingDate,
              value,
              cumulativeUsage,
            })),
          purchasedUnits,
          warnings,
        }),
      )
      .digest("hex");
    return {
      meter: { id: meter.id, meterNumber: meter.meterNumber, meterType: meter.meterType },
      warnings,
      reviewToken: this.sign(fingerprint),
    };
  }

  requireConfirmation(
    review: ReadingReview,
    dto: Pick<CreateReadingDto, "reviewToken" | "reviewReason">,
    userId: string,
  ): Prisma.InputJsonValue | undefined {
    if (!review.warnings.length) return undefined;
    if (
      !dto.reviewToken ||
      !this.matches(dto.reviewToken, review.reviewToken) ||
      (dto.reviewReason?.trim().length ?? 0) < 5
    )
      throw new ConflictException({
        code: "READING_CONFIRMATION_REQUIRED",
        message:
          "This reading needs review. Check the warnings and enter a reason before confirming.",
        ...review,
      });
    return {
      warnings: review.warnings.map((warning) => ({ ...warning })),
      reason: dto.reviewReason!.trim(),
      confirmedBy: userId,
      confirmedAt: new Date().toISOString(),
    };
  }

  async create(
    dto: CreateReadingDto,
    user: AuthenticatedUser,
    tx?: Prisma.TransactionClient,
    staged: ReadingObservation[] = [],
  ) {
    const save = async (db: Prisma.TransactionClient) => {
      await db.$queryRaw(
        Prisma.sql`SELECT id FROM water_meters WHERE id = ${dto.meterId} FOR UPDATE`,
      );
      const review = await this.assess(dto, user.id, db, undefined, staged);
      return this.createReviewed(dto, user, review, db);
    };
    return tx
      ? save(tx)
      : this.prisma.$transaction(save, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        });
  }

  createReviewed(
    dto: CreateReadingDto,
    user: AuthenticatedUser,
    review: ReadingReview,
    db: Prisma.TransactionClient,
  ) {
    const acknowledgement = this.requireConfirmation(review, dto, user.id);
    return db.waterMeterReading.create({
      data: {
        meterId: dto.meterId,
        readingDate: new Date(dto.readingDate),
        value: dto.value ?? null,
        cumulativeUsage: dto.cumulativeUsage ?? null,
        notes: dto.notes?.trim() || null,
        createdBy: user.id,
        ...(acknowledgement && { review: acknowledgement }),
      },
    });
  }

  async update(id: string, dto: UpdateReadingDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(
      async (db) => {
        const initial = await db.waterMeterReading.findUniqueOrThrow({ where: { id } });
        for (const meterId of [
          ...new Set([initial.meterId, dto.meterId ?? initial.meterId]),
        ].sort())
          await db.$queryRaw(
            Prisma.sql`SELECT id FROM water_meters WHERE id = ${meterId} FOR UPDATE`,
          );
        const existing = await db.waterMeterReading.findUniqueOrThrow({ where: { id } });
        if (existing.meterId !== initial.meterId)
          throw new ConflictException(
            "This reading moved to another meter. Refresh and review it again.",
          );
        const candidate: CreateReadingDto = {
          meterId: dto.meterId ?? existing.meterId,
          readingDate: dto.readingDate ?? existing.readingDate.toISOString(),
          value:
            dto.value === undefined
              ? existing.value === null
                ? null
                : Number(existing.value)
              : dto.value,
          cumulativeUsage:
            dto.cumulativeUsage === undefined
              ? existing.cumulativeUsage === null
                ? null
                : Number(existing.cumulativeUsage)
              : dto.cumulativeUsage,
          reviewToken: dto.reviewToken,
          reviewReason: dto.reviewReason,
        };
        const review = await this.assess(candidate, user.id, db, id);
        const acknowledgement = this.requireConfirmation(review, candidate, user.id);
        const history =
          existing.review && typeof existing.review === "object" && !Array.isArray(existing.review)
            ? existing.review
            : {};
        const previous = Array.isArray(history.confirmations)
          ? history.confirmations
          : existing.review
            ? [existing.review]
            : [];
        const confirmations = acknowledgement ? [...previous, acknowledgement] : previous;
        return db.waterMeterReading.update({
          where: { id },
          data: {
            meterId: candidate.meterId,
            readingDate: new Date(candidate.readingDate),
            value: candidate.value,
            cumulativeUsage: candidate.cumulativeUsage,
            notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
            ...(confirmations.length && { review: { confirmations } as Prisma.InputJsonValue }),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private sign(fingerprint: string): string {
    const secret = this.config.get<string>("JWT_ACCESS_SECRET");
    if (!secret) throw new Error("Reading confirmation signing is not configured.");
    return createHmac("sha256", secret).update(fingerprint).digest("base64url");
  }

  private matches(provided: string, expected: string): boolean {
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
