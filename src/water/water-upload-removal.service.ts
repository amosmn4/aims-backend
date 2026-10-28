import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { WaterDatabase } from "./water-reading-review.service";

export type WaterUploadKind = "ai" | "standard";
export type WaterEntityType = "reading" | "purchase" | "usage" | "meter" | "customer";
const names = {
  reading: "waterMeterReading",
  purchase: "waterUsageRecord",
  usage: "waterMeterUsageInterval",
  meter: "waterMeter",
  customer: "waterCustomer",
} as const;
interface EntityDelegate {
  findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

@Injectable()
export class WaterUploadRemovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async track(
    db: WaterDatabase,
    uploadKind: WaterUploadKind,
    uploadId: string,
    entityType: WaterEntityType,
    record: { id: string },
  ) {
    await db.waterUploadEntity.create({
      data: { uploadKind, uploadId, entityType, entityId: record.id, snapshot: json(record) },
    });
  }

  async preview(
    uploadKind: WaterUploadKind,
    uploadId: string,
    user: AuthenticatedUser,
    db: WaterDatabase = this.prisma,
    includeLegacyAccounts = false,
  ) {
    const upload =
      uploadKind === "ai"
        ? await db.waterImportBatch.findUnique({ where: { id: uploadId } })
        : await db.waterUsageUpload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new NotFoundException("Upload not found.");
    const tracked = await db.waterUploadEntity.findMany({ where: { uploadKind, uploadId } });
    const ownership = new Map(tracked.map((row) => [`${row.entityType}:${row.entityId}`, row]));
    const legacy =
      uploadKind === "ai"
        ? (
            await db.waterImportRow.findMany({
              where: { batchId: uploadId, status: "imported", targetId: { not: null } },
            })
          )
            .filter((row) => row.targetType && row.targetType in names)
            .map((row) => ({ entityType: row.targetType!, entityId: row.targetId! }))
        : (await db.waterUsageRecord.findMany({ where: { uploadId }, select: { id: true } })).map(
            (row) => ({ entityType: "purchase", entityId: row.id }),
          );
    const entries = new Map(
      [...tracked, ...legacy].map((row) => [`${row.entityType}:${row.entityId}`, row]),
    );
    const entities: {
      type: WaterEntityType;
      id: string;
      label: string;
      changedSinceImport: boolean;
      current: unknown;
    }[] = [];
    for (const entry of [...entries.values()].sort((a, b) =>
      `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`),
    )) {
      const type = entry.entityType as WaterEntityType;
      const record = await this.delegate(db, type).findUnique({ where: { id: entry.entityId } });
      if (!record) continue;
      const origin = ownership.get(`${type}:${entry.entityId}`);
      entities.push({
        type,
        id: entry.entityId,
        label: String(
          record.meterNumber ??
            record.name ??
            record.customerName ??
            record.readingDate ??
            record.id,
        ),
        changedSinceImport: !!origin && canonical(json(record)) !== canonical(origin.snapshot),
        current: json(record),
      });
    }
    const legacyCandidates: typeof entities = [];
    const hasLegacy = legacy.some((row) => !ownership.has(`${row.entityType}:${row.entityId}`));
    if (hasLegacy && upload.createdAt) {
      const parentMeters = new Map<string, Record<string, unknown>>();
      for (const entity of entities) {
        const current = entity.current as Record<string, unknown>;
        const meterId =
          entity.type === "meter"
            ? entity.id
            : typeof current.meterId === "string"
              ? current.meterId
              : null;
        if (!meterId) continue;
        const meter = await db.waterMeter.findUnique({ where: { id: meterId } });
        if (!meter) continue;
        parentMeters.set(meter.id, meter as unknown as Record<string, unknown>);
        const recordedAt = current.createdAt ? new Date(String(current.createdAt)) : null;
        if (
          !entities.some((row) => row.type === "meter" && row.id === meter.id) &&
          meter.createdAt >= upload.createdAt &&
          recordedAt &&
          meter.createdAt <= recordedAt &&
          !legacyCandidates.some((row) => row.type === "meter" && row.id === meter.id)
        )
          legacyCandidates.push({
            type: "meter",
            id: meter.id,
            label: meter.meterNumber,
            changedSinceImport: false,
            current: json(meter),
          });
      }
      for (const meter of parentMeters.values()) {
        if (typeof meter.customerId !== "string") continue;
        const customer = await db.waterCustomer.findUnique({ where: { id: meter.customerId } });
        if (
          customer &&
          customer.createdAt >= upload.createdAt &&
          customer.createdAt <=
            (meter.createdAt instanceof Date
              ? meter.createdAt
              : new Date(String(meter.createdAt))) &&
          !entities.some((row) => row.type === "customer" && row.id === customer.id) &&
          !legacyCandidates.some((row) => row.type === "customer" && row.id === customer.id)
        )
          legacyCandidates.push({
            type: "customer",
            id: customer.id,
            label: customer.name,
            changedSinceImport: false,
            current: json(customer),
          });
      }
      if (includeLegacyAccounts) entities.push(...legacyCandidates);
    }
    const ids = (type: WaterEntityType) =>
      entities.filter((row) => row.type === type).map((row) => row.id);
    const meterIds = ids("meter"),
      customerIds = ids("customer");
    const blockers: string[] = [];
    if (meterIds.length) {
      const counts = await Promise.all([
        db.waterMeterReading.count({
          where: { meterId: { in: meterIds }, id: { notIn: ids("reading") } },
        }),
        db.waterUsageRecord.count({
          where: { meterId: { in: meterIds }, id: { notIn: ids("purchase") } },
        }),
        db.waterMeterUsageInterval.count({
          where: { meterId: { in: meterIds }, id: { notIn: ids("usage") } },
        }),
        db.waterMeter.count({
          where: { replacesMeterId: { in: meterIds }, id: { notIn: meterIds } },
        }),
      ]);
      if (counts.some(Boolean))
        blockers.push(
          `Meters created by this upload now have ${counts.reduce((sum, count) => sum + count, 0)} records or replacement links from outside this upload. Resolve these dependencies before removing the upload.`,
        );
    }
    if (customerIds.length) {
      const counts = await Promise.all([
        db.waterMeter.count({
          where: { customerId: { in: customerIds }, id: { notIn: meterIds } },
        }),
        db.waterUsageRecord.count({
          where: { customerId: { in: customerIds }, id: { notIn: ids("purchase") } },
        }),
      ]);
      if (counts.some(Boolean))
        blockers.push(
          `Customers created by this upload now have ${counts.reduce((sum, count) => sum + count, 0)} records from outside this upload. Resolve these dependencies before removal.`,
        );
    }
    const warnings = hasLegacy
      ? [
          includeLegacyAccounts
            ? "This older upload has incomplete ownership logs. The related meters and customers you selected are included in this deletion. Pre-existing accounts are retained."
            : "This older upload has incomplete ownership logs. Possible related meters and customers require separate confirmation before removal. Pre-existing accounts are retained.",
        ]
      : [];
    const summary = {
      uploadKind,
      uploadId,
      fileName: upload.fileName,
      status: "status" in upload ? upload.status : "completed",
      counts: Object.fromEntries(
        Object.keys(names).map((type) => [type, ids(type as WaterEntityType).length]),
      ),
      blockers,
      warnings,
      changedRecords: entities.filter((row) => row.changedSinceImport).length,
      includeLegacyAccounts,
    };
    const token = createHmac("sha256", this.config.getOrThrow<string>("JWT_ACCESS_SECRET"))
      .update(canonical({ userId: user.id, ...summary, entities, legacyCandidates }))
      .digest("base64url");
    return { ...summary, token, entities, legacyCandidates };
  }

  async remove(
    uploadKind: WaterUploadKind,
    uploadId: string,
    token: string,
    user: AuthenticatedUser,
    includeLegacyAccounts = false,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const table = uploadKind === "ai" ? "water_import_batches" : "water_usage_uploads";
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id = ${uploadId} FOR UPDATE`,
        );
        const preview = await this.preview(uploadKind, uploadId, user, tx, includeLegacyAccounts);
        const meterIds = [
          ...new Set(
            preview.entities.flatMap((row) =>
              row.type === "meter"
                ? [row.id]
                : row.current &&
                    typeof row.current === "object" &&
                    "meterId" in row.current &&
                    typeof row.current.meterId === "string"
                  ? [row.current.meterId]
                  : [],
            ),
          ),
        ].sort();
        for (const meterId of meterIds)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM water_meters WHERE id = ${meterId} FOR UPDATE`,
          );
        for (const row of preview.entities
          .filter((row) => row.type === "customer")
          .sort((a, b) => a.id.localeCompare(b.id)))
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM water_customers WHERE id = ${row.id} FOR UPDATE`,
          );
        const current = await this.preview(uploadKind, uploadId, user, tx, includeLegacyAccounts);
        if (current.token !== token)
          throw new ConflictException(
            "The upload or its records changed. Review the deletion preview again.",
          );
        if (current.blockers.length) throw new ConflictException(current.blockers.join(" "));
        const counts: Record<string, number> = {};
        for (const type of ["reading", "purchase", "usage", "meter", "customer"] as const) {
          const ids = current.entities.filter((row) => row.type === type).map((row) => row.id);
          counts[type] = ids.length
            ? (await this.delegate(tx, type).deleteMany({ where: { id: { in: ids } } })).count
            : 0;
        }
        await tx.waterUploadEntity.deleteMany({ where: { uploadKind, uploadId } });
        let cleanupId: string | null = null;
        if (uploadKind === "ai") {
          const upload = await tx.waterImportBatch.findUniqueOrThrow({ where: { id: uploadId } });
          const cleanup = await tx.waterUploadRemovalJob.create({
            data: { storageKey: upload.storageKey },
          });
          cleanupId = cleanup.id;
          await tx.waterImportBatch.delete({ where: { id: uploadId } });
        } else await tx.waterUsageUpload.delete({ where: { id: uploadId } });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "delete",
            entityType: "water_upload",
            entityId: uploadId,
            metadata: { uploadKind, counts, removalConfirmed: true },
          },
        });
        return { id: uploadId, counts, cleanupId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60000 },
    );
    if (result.cleanupId) await this.cleanFile(result.cleanupId);
    return {
      id: result.id,
      counts: result.counts,
      sourceFilePendingRemoval: result.cleanupId
        ? !!(await this.prisma.waterUploadRemovalJob.findUnique({
            where: { id: result.cleanupId },
          }))
        : false,
    };
  }

  @Interval(30000)
  async cleanFiles() {
    const jobs = await this.prisma.waterUploadRemovalJob.findMany({
      take: 10,
      orderBy: { createdAt: "asc" },
    });
    for (const job of jobs) await this.cleanFile(job.id);
  }

  private async cleanFile(id: string) {
    const job = await this.prisma.waterUploadRemovalJob.findUnique({ where: { id } });
    if (!job) return;
    try {
      await this.storage.delete(job.storageKey);
      await this.prisma.waterUploadRemovalJob.deleteMany({ where: { id } });
    } catch (error) {
      await this.prisma.waterUploadRemovalJob.updateMany({
        where: { id },
        data: {
          attempts: { increment: 1 },
          error: (error instanceof Error ? error.message : "Source file removal failed").slice(
            0,
            1000,
          ),
        },
      });
    }
  }

  private delegate(db: WaterDatabase, type: WaterEntityType): EntityDelegate {
    return (db as unknown as Record<string, EntityDelegate>)[names[type]];
  }
}
