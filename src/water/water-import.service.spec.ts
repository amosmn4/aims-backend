import { describe, expect, it, jest } from "@jest/globals";
import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { WaterImportRow } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { WaterFileExtractionService } from "./water-file-extraction.service";
import { WaterReadingReviewService } from "./water-reading-review.service";
import { WaterImportService } from "./water-import.service";
import { emptyImportRecord } from "./water-import.types";
import { WaterImportSuggestionsService } from "./water-import-suggestions.service";
import { WaterUploadRemovalService } from "./water-upload-removal.service";

const user: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["water"],
  departmentId: null,
};

function fixture() {
  const batch = {
    id: "batch",
    status: "review",
    storageKey: "private/source.csv",
    fileHash: "private-hash",
    leaseUntil: null,
    totalRows: 1,
    previewVersion: 0,
  };
  const rows: WaterImportRow[] = [
    {
      id: "row",
      batchId: "batch",
      position: 1,
      source: "Sheet1, row 2",
      raw: { Meter: "B01", Reading: 21500 },
      data: {
        ...emptyImportRecord(),
        kind: "reading",
        meterNumber: "B01",
        date: "2026-01-10T09:00:00Z",
        dialReading: 21500,
      },
      status: "pending",
      issues: [],
      warnings: [],
      updatedAt: new Date("2026-01-10"),
      createdAt: new Date("2026-01-10"),
      targetId: null,
      targetType: null,
      confirmedAt: null,
      confirmedBy: null,
    },
  ];
  const history = [
    {
      id: "before",
      meterId: "meter",
      readingDate: new Date("2026-01-09T09:00:00Z"),
      value: 22000 as number | null,
      cumulativeUsage: null as number | null,
    },
  ];
  const meter = {
    id: "meter",
    meterNumber: "B01",
    meterType: "bulk",
    isActive: true,
    installedAt: null,
    name: "Zone bulk",
    customer: null as { name: string } | null,
  };
  const filterRows = (where?: { status?: string }) =>
    rows.filter((row) => !where?.status || row.status === where.status);
  const counts = () =>
    Object.entries(
      rows.reduce<Record<string, number>>((counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
      }, {}),
    ).map(([status, count]) => ({ status, _count: { _all: count } }));
  const db = {
    waterImportBatch: {
      findFirst: jest.fn(async () => (batch.status === "recording" ? batch : null)),
      updateMany: jest.fn(async ({ data }: { data: object }) => {
        Object.assign(batch, data);
        return { count: 1 };
      }),
      findUnique: jest.fn(async () => batch),
      update: jest.fn(async ({ data }: { data: object }) => Object.assign(batch, data)),
    },
    waterImportRow: {
      findMany: jest.fn(async ({ where }: { where?: { status?: string } }) => filterRows(where)),
      count: jest.fn(
        async ({ where }: { where?: { status?: string } }) => filterRows(where).length,
      ),
      groupBy: jest.fn(async () => counts()),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: object }) =>
        Object.assign(
          rows.find((row) => row.id === where.id)!,
          data,
        ),
      ),
    },
    waterMeter: { findUnique: jest.fn(async () => meter) },
    waterMeterReading: {
      findFirst: jest.fn(
        async ({ where }: { where: { readingDate: Date } }) =>
          history.find((row) => +row.readingDate === +where.readingDate) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: { readingDate: { lt?: Date; gt?: Date } } }) =>
        history.filter((row) =>
          where.readingDate.lt
            ? row.readingDate < where.readingDate.lt
            : row.readingDate > where.readingDate.gt!,
        ),
      ),
      create: jest.fn(async ({ data }: { data: Omit<(typeof history)[number], "id"> }) => {
        const row = { id: `saved-${history.length}`, ...data };
        history.push(row);
        return row;
      }),
    },
    waterUsageRecord: { aggregate: jest.fn(async () => ({ _sum: { unitsSold: 0 } })) },
    auditLog: { create: jest.fn(async (_data: unknown) => ({})) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  const storage = { write: jest.fn(async () => undefined), delete: jest.fn(async () => undefined) };
  const config = new ConfigService({ JWT_ACCESS_SECRET: "test-only-import-secret" });
  const readings = new WaterReadingReviewService(db as unknown as PrismaService, config);
  const service = new WaterImportService(
    db as unknown as PrismaService,
    storage as unknown as StorageService,
    {} as WaterFileExtractionService,
    readings,
    config,
    { suggest: jest.fn(async () => []) } as unknown as WaterImportSuggestionsService,
    { track: jest.fn(async () => undefined) } as unknown as WaterUploadRemovalService,
  );
  return { service, db, rows, history, storage, batch, meter };
}

describe("Water import confirmation", () => {
  it("keeps numerical corrections in the source units when importing litres", async () => {
    const { service, rows } = fixture();
    rows[0].data = {
      ...emptyImportRecord(),
      kind: "reading",
      meterNumber: "B01",
      date: "2026-01-10T09:00:00Z",
      dialReading: 21500000,
      volumeUnit: "litres",
    };
    const preview = await service.get("batch", user);
    expect(preview.rows[0].assessment?.suggestions[0].patch).toEqual({ dialReading: 22500000 });
  });

  it("holds a known household meter for review when the source names a different owner", async () => {
    const { service, rows, meter, history } = fixture();
    meter.meterType = "household";
    meter.customer = { name: "Registered household" };
    history[0].cumulativeUsage = 100;
    history[0].value = 20;
    rows[0].data = {
      ...emptyImportRecord(),
      kind: "reading",
      meterNumber: "B01",
      date: "2026-01-10T09:00:00Z",
      remainingBalance: 15,
      cumulativeUsage: 105,
      customerName: "Different household",
    };
    const preview = await service.get("batch", user);
    expect(preview.rows[0].assessment?.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "customer_name_mismatch" })]),
    );
    expect(preview.rows[0].assessment?.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patch: { customerName: "Registered household" } }),
      ]),
    );
    expect(preview.rows[0].assessment?.status).toBe("warning");
  });

  it("requires a complete extraction preview before bulk recording", async () => {
    const { service, db } = fixture();
    await expect(service.beginRecording("batch", user)).rejects.toBeInstanceOf(ConflictException);
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("invalidates preview approval when the extracted data is corrected", async () => {
    const { service, batch } = fixture();
    const preview = await service.get("batch", user);
    batch.previewVersion++;
    await expect(
      service.beginRecording("batch", user, preview.previewToken!),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("records all validated rows through the background worker after one confirmation", async () => {
    const { service, rows, db } = fixture();
    rows[0].data = {
      ...emptyImportRecord(),
      kind: "reading",
      meterNumber: "B01",
      date: "2026-01-10T09:00:00Z",
      dialReading: 22100,
    };
    await service.beginRecording("batch", user, (await service.get("batch", user)).previewToken!);
    await service.processNext();
    await service.processNext();
    expect(db.waterMeterReading.create).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("imported");
  });

  it("holds warning rows for explicit individual review during bulk recording", async () => {
    const { service, rows, db } = fixture();
    await service.beginRecording("batch", user, (await service.get("batch", user)).previewToken!);
    await service.processNext();
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("pending");
    expect(await service.get("batch", user)).toMatchObject({ status: "review" });
  });

  it("applies the same red warning as manual capture and hides private storage metadata", async () => {
    const { service } = fixture();
    const preview = await service.get("batch", user);
    expect(preview).not.toHaveProperty("storageKey");
    expect(preview).not.toHaveProperty("fileHash");
    expect(preview.rows[0].assessment?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "counter_decreased", severity: "danger" }),
      ]),
    );
  });

  it("requires an explicit warning reason before saving imported readings", async () => {
    const { service, db } = fixture();
    const preview = await service.get("batch", user);
    await expect(
      service.confirm(
        "batch",
        {
          rows: [{ id: "row", reviewToken: preview.rows[0].assessment!.reviewToken }],
          previewToken: preview.previewToken!,
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("records an acknowledged import exactly once across repeated confirmations", async () => {
    const { service, db, rows } = fixture();
    const preview = await service.get("batch", user);
    const request = {
      previewToken: preview.previewToken!,
      rows: [
        {
          id: "row",
          reviewToken: preview.rows[0].assessment!.reviewToken,
          reviewReason: "Checked the meter and verified the counter reset",
        },
      ],
    };
    await service.confirm("batch", request, user);
    await service.confirm("batch", request, user);
    expect(db.waterMeterReading.create).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({
      status: "imported",
      confirmedBy: user.id,
      targetType: "reading",
    });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects stale previews instead of recording after meter history changes", async () => {
    const { service, db, history } = fixture();
    const preview = await service.get("batch", user);
    history[0].value = 23000;
    await expect(
      service.confirm(
        "batch",
        {
          previewToken: preview.previewToken!,
          rows: [
            {
              id: "row",
              reviewToken: preview.rows[0].assessment!.reviewToken,
              reviewReason: "Verified the reading",
            },
          ],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.waterMeterReading.create).not.toHaveBeenCalled();
  });

  it("rejects files whose signatures do not match their extension", async () => {
    const { service, storage } = fixture();
    const buffer = Buffer.from("not a PDF");
    await expect(
      service.upload(
        { originalname: "bad.pdf", size: buffer.length, buffer } as Express.Multer.File,
        user,
      ),
    ).rejects.toThrow("does not match");
    expect(storage.write).not.toHaveBeenCalled();
  });
});
