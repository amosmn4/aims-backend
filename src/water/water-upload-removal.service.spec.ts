import { describe, expect, it, jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { ConflictException } from "@nestjs/common";
import { WaterUploadRemovalService } from "./water-upload-removal.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["water"],
  departmentId: null,
};

function fixture() {
  const entities = [
    {
      type: "reading",
      model: "waterMeterReading",
      record: { id: "reading", meterId: "meter", value: 25 },
    },
    {
      type: "purchase",
      model: "waterUsageRecord",
      record: { id: "purchase", meterId: "meter", customerId: "customer", unitsSold: 5 },
    },
    {
      type: "usage",
      model: "waterMeterUsageInterval",
      record: { id: "usage", meterId: "meter", units: 3 },
    },
    {
      type: "meter",
      model: "waterMeter",
      record: { id: "meter", customerId: "customer", meterNumber: "000123" },
    },
    {
      type: "customer",
      model: "waterCustomer",
      record: { id: "customer", name: "Test household" },
    },
  ];
  const origins = entities.map((entity) => ({
    id: `origin-${entity.type}`,
    uploadKind: "ai",
    uploadId: "upload",
    entityType: entity.type,
    entityId: entity.record.id,
    snapshot: { ...entity.record },
  }));
  let sourceExists = true;
  let cleanup: { id: string; storageKey: string } | null = null;
  let outside = 0;
  const deletes = jest.fn(async (_args: unknown) => ({ count: 1 }));
  const delegates = Object.fromEntries(
    entities.map((entity) => [
      entity.model,
      {
        findUnique: jest.fn(async () => entity.record),
        deleteMany: deletes,
        count: jest.fn(async () => (entity.type === "reading" ? outside : 0)),
        findMany: jest.fn(async () => []),
      },
    ]),
  );
  const db = {
    ...delegates,
    waterImportBatch: {
      findUnique: jest.fn(async () =>
        sourceExists
          ? {
              id: "upload",
              fileName: "test.csv",
              status: "review",
              storageKey: "water-imports/test.csv",
            }
          : null,
      ),
      findUniqueOrThrow: jest.fn(async () => ({
        id: "upload",
        storageKey: "water-imports/test.csv",
      })),
      delete: jest.fn(async (_args: unknown) => {
        sourceExists = false;
        return {};
      }),
    },
    waterImportRow: { findMany: jest.fn(async () => []) },
    waterUploadEntity: {
      findMany: jest.fn(async () => origins),
      deleteMany: jest.fn(async () => ({ count: origins.length })),
      create: jest.fn(async (_args: unknown) => ({})),
    },
    waterUploadRemovalJob: {
      findMany: jest.fn(async () => (cleanup ? [cleanup] : [])),
      create: jest.fn(
        async ({ data }: { data: { storageKey: string } }) =>
          (cleanup = { id: "cleanup", ...data }),
      ),
      findUnique: jest.fn(async () => cleanup),
      deleteMany: jest.fn(async () => {
        cleanup = null;
        return { count: 1 };
      }),
      updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
    },
    auditLog: { create: jest.fn(async (_args: unknown) => ({})) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  const storage = { delete: jest.fn(async (_key: string) => undefined) };
  const service = new WaterUploadRemovalService(
    db as unknown as PrismaService,
    storage as unknown as StorageService,
    new ConfigService({ JWT_ACCESS_SECRET: "test-only-removal-secret" }),
  );
  return {
    service,
    db,
    storage,
    origins,
    entities,
    deletes,
    setOutside: (value: number) => {
      outside = value;
    },
  };
}

describe("Complete upload removal", () => {
  it("removes every proven owned record, the batch and its source file, retaining a removal audit", async () => {
    const { service, db, storage, deletes } = fixture();
    const preview = await service.preview("ai", "upload", user);
    expect(preview.counts).toEqual({ reading: 1, purchase: 1, usage: 1, meter: 1, customer: 1 });
    const result = await service.remove("ai", "upload", preview.token, user);
    expect(deletes).toHaveBeenCalledTimes(5);
    expect(db.waterImportBatch.delete).toHaveBeenCalledWith({ where: { id: "upload" } });
    expect(storage.delete).toHaveBeenCalledWith("water-imports/test.csv");
    expect(result.sourceFilePendingRemoval).toBe(false);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("blocks before deleting anything when later independent readings depend on an imported meter", async () => {
    const { service, deletes, setOutside } = fixture();
    setOutside(1);
    const preview = await service.preview("ai", "upload", user);
    expect(preview.blockers).toHaveLength(1);
    await expect(service.remove("ai", "upload", preview.token, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deletes).not.toHaveBeenCalled();
  });

  it("requires a fresh preview if an imported record changes", async () => {
    const { service, deletes, entities } = fixture();
    const preview = await service.preview("ai", "upload", user);
    entities[0].record.value = 27;
    await expect(service.remove("ai", "upload", preview.token, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deletes).not.toHaveBeenCalled();
  });

  it("preserves reused meters and customers because they have no ownership entry for the upload", async () => {
    const { service, origins, deletes } = fixture();
    origins.splice(3, 2);
    const preview = await service.preview("ai", "upload", user);
    expect(preview.counts.meter).toBe(0);
    expect(preview.counts.customer).toBe(0);
    await service.remove("ai", "upload", preview.token, user);
    expect(deletes).toHaveBeenCalledTimes(3);
  });

  it("retains a retry job when private source storage is temporarily unavailable", async () => {
    const { service, storage, db } = fixture();
    storage.delete.mockRejectedValueOnce(new Error("Storage unavailable") as never);
    const preview = await service.preview("ai", "upload", user);
    const result = await service.remove("ai", "upload", preview.token, user);
    expect(result.sourceFilePendingRemoval).toBe(true);
    expect(db.waterUploadRemovalJob.updateMany).toHaveBeenCalled();
    await service.cleanFiles();
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });
});
