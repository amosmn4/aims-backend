import { describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../prisma/prisma.service";
import { WaterImportSuggestionsService } from "./water-import-suggestions.service";
import { emptyImportRecord } from "./water-import.types";

describe("Import identity suggestions", () => {
  it("finds a recorded household by approximate name even when its meter number was missing", async () => {
    const records = [
      {
        id: "mary",
        meterNumber: "000123",
        meterType: "household",
        name: null,
        plotNo: "A1",
        isActive: true,
        customer: { name: "Mary Wanjiku", phone: "0712345678" },
        zone: { name: "Zone A" },
      },
      {
        id: "other",
        meterNumber: "000222",
        meterType: "household",
        name: null,
        plotNo: "B9",
        isActive: true,
        customer: { name: "Peter Kamau", phone: null },
        zone: { name: "Zone B" },
      },
    ];
    const db = { waterMeter: { findMany: jest.fn(async () => records) } };
    const service = new WaterImportSuggestionsService(db as unknown as PrismaService);
    const data = {
      ...emptyImportRecord(),
      kind: "reading" as const,
      customerName: "Mary Wanjku",
      zone: "Zone A",
    };
    const suggestions = await service.suggest(data);
    expect(suggestions[0]).toMatchObject({
      recordId: "mary",
      patch: { meterNumber: "000123", customerName: "Mary Wanjiku" },
    });
    expect(data.meterNumber).toBeNull();
  });

  it("returns multiple same-name candidates for review instead of choosing an account", async () => {
    const db = {
      waterMeter: {
        findMany: jest.fn(async () =>
          ["001", "002"].map((meterNumber) => ({
            id: meterNumber,
            meterNumber,
            meterType: "household",
            name: null,
            plotNo: null,
            isActive: true,
            customer: { name: "John Smith", phone: null },
            zone: null,
          })),
        ),
      },
    };
    const result = await new WaterImportSuggestionsService(db as unknown as PrismaService).suggest({
      ...emptyImportRecord(),
      kind: "reading",
      customerName: "John Smith",
    });
    expect(result).toHaveLength(2);
    expect(new Set(result.map((item) => item.patch.meterNumber)).size).toBe(2);
  });
});
