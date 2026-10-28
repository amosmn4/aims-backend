import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AiDataService, safeAiData } from "./ai-data.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { DocumentsService } from "../documents/documents.service";
import type { ReportAccessService } from "../reports/report-access.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const admin: AuthenticatedUser = {
  id: "admin",
  email: "admin@example.test",
  roles: ["system_admin"],
  departmentId: null,
};
const staff: AuthenticatedUser = { ...admin, id: "staff", roles: ["water"] };
const query = (overrides: Record<string, unknown> = {}) => ({
  model: "WaterUsageRecord",
  operation: "rows",
  filters: "{}",
  page: 1,
  ...overrides,
});

function fixture() {
  const delegate = {
    count: jest.fn(async (_args: unknown) => 100),
    findMany: jest.fn(async (_args: unknown) => [
      { id: "old-payment", recordedAt: new Date("2024-01-01"), amountPaid: "500" },
    ]),
    aggregate: jest.fn(async (_args: unknown) => ({
      _min: { recordedAt: new Date("2024-01-01") },
      _max: { recordedAt: new Date("2026-09-01") },
      _sum: { amountPaid: "50000" },
    })),
    groupBy: jest.fn(async (_args: unknown) => [
      { meterId: "meter", _sum: { amountPaid: "50000" }, _count: { _all: 100 } },
    ]),
  };
  const db = {
    waterUsageRecord: delegate,
    expense: delegate,
    user: delegate,
    waterMeterReading: delegate,
    department: { findMany: jest.fn(async () => []) },
    userPermissionOverride: { findMany: jest.fn(async () => []) },
  };
  const service = new AiDataService(
    db as unknown as PrismaService,
    {} as DocumentsService,
    {} as ReportAccessService,
  );
  return { service, db, delegate };
}

describe("System-wide AI database reads", () => {
  it("queries all stored history without imposing the current month or active status", async () => {
    const { service, delegate } = fixture();
    const response = await service.query(query(), admin);
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{}, {}] }, take: 25 }),
    );
    expect(response).toMatchObject({
      matchedRecords: 100,
      result: { nextPage: 2 },
      dateCoverage: { restriction: "All stored history; no month or active-status filter" },
    });
  });

  it("calculates a total using all matches rather than the displayed page", async () => {
    const { service, delegate } = fixture();
    const response = await service.query(
      query({ operation: "aggregate", metrics: [{ field: "amountPaid", operation: "sum" }] }),
      admin,
    );
    expect(delegate.aggregate).toHaveBeenLastCalledWith({
      where: { AND: [{}, {}] },
      _count: true,
      _sum: { amountPaid: true },
    });
    expect(delegate.findMany).not.toHaveBeenCalled();
    expect(response.matchedRecords).toBe(100);
  });

  it("preserves an explicitly requested historical date range", async () => {
    const { service, delegate } = fixture();
    await service.query(
      query({
        filters: JSON.stringify({
          recordedAt: { gte: "2024-01-01T00:00:00+03:00", lt: "2025-01-01T00:00:00+03:00" },
        }),
      }),
      staff,
    );
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              recordedAt: {
                gte: new Date("2023-12-31T21:00:00Z"),
                lt: new Date("2024-12-31T21:00:00Z"),
              },
            },
            {},
          ],
        },
      }),
    );
  });

  it("requires an explicit timezone on date filters", async () => {
    await expect(
      fixture().service.query(
        query({ filters: JSON.stringify({ recordedAt: { gte: "2024-01-01T00:00:00" } }) }),
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("signals when grouped results have another page without truncating aggregate totals", async () => {
    const { service, delegate } = fixture();
    delegate.groupBy.mockResolvedValueOnce(
      Array.from({ length: 51 }, (_, index) => ({
        meterId: String(index),
        _sum: { amountPaid: "50000" },
        _count: { _all: 100 },
      })),
    );
    const response = await service.query(
      query({ operation: "group", groupBy: ["meterId"], page: 2 }),
      admin,
    );
    expect(response.result).toMatchObject({ page: 2, pageSize: 50, nextPage: 3 });
    expect((response.result as { groups: unknown[] }).groups).toHaveLength(50);
    expect(delegate.groupBy).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 51 }));
  });

  it("keeps Finance records behind Finance access even for a Water user", async () => {
    const { service, delegate } = fixture();
    await expect(service.query(query({ model: "Expense" }), staff)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { model: "PasswordSetupToken" },
    { model: "User", fields: ["passwordHash"] },
    { operation: "deleteMany" },
    { filters: JSON.stringify({ meter: { customer: {} } }) },
  ])("rejects unavailable or mutating queries: %j", async (input) => {
    await expect(fixture().service.query(query(input), admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("exposes all business model types and foreign keys, while removing credential fields recursively", () => {
    const catalog = fixture().service.catalog();
    expect(catalog.map((entry) => entry.model)).toEqual(
      expect.arrayContaining([
        "Expense",
        "Project",
        "Invoice",
        "WaterMeterReading",
        "Report",
        "Client",
      ]),
    );
    expect(catalog.find((entry) => entry.model === "WaterUsageRecord")?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "WaterMeter", foreignKeys: ["meterId"] }),
      ]),
    );
    expect(safeAiData({ nested: { passwordHash: "hidden", token: "hidden", amount: 10 } })).toEqual(
      { nested: { amount: 10 } },
    );
  });
});
