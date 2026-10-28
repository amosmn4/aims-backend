import { describe, expect, it } from "@jest/globals";
import { intervalFlow } from "./usage-interval";
import { balanceUsageInWindow, balancePeriods } from "./household-balance";
import { importDate, volumeFactor } from "./water-import.types";

const start = new Date("2026-01-01T00:00:00Z");
const middle = new Date("2026-01-15T00:00:00Z");
const end = new Date("2026-02-01T00:00:00Z");

describe("Independent imported measurements", () => {
  it("keeps opening-boundary purchases in this counter-only period and closing-boundary purchases in the next one", () => {
    const readings = [
      { id: "opening", readingDate: start, value: null, cumulativeUsage: 519 },
      { id: "closing", readingDate: end, value: null, cumulativeUsage: 549 },
    ];
    expect(
      balanceUsageInWindow(
        readings,
        [
          { recordedAt: start, units: 10 },
          { recordedAt: middle, units: 5 },
          { recordedAt: end, units: 20 },
        ],
        start,
        end,
      ),
    ).toMatchObject({ purchased: 15, measuredUsed: 30 });
  });

  it("does not hide a reset captured between two prepaid balance readings", () => {
    const readings = [
      { id: "opening", readingDate: start, value: 10, cumulativeUsage: 100 },
      { id: "reset", readingDate: middle, value: null, cumulativeUsage: 90 },
      { id: "closing", readingDate: end, value: 0, cumulativeUsage: 110 },
    ];
    expect(balancePeriods(readings, [])[0].flags).toContain("counter_decreased");
    expect(balancePeriods(readings, [])[0].measuredUsed).toBeNull();
    expect(balanceUsageInWindow(readings, [], start, end)).toBeNull();
  });

  it("calculates household consumption from counters without inventing prepaid balances", () => {
    const readings = [
      { id: "opening", readingDate: start, value: null, cumulativeUsage: 519 },
      { id: "closing", readingDate: end, value: null, cumulativeUsage: 549 },
    ];
    expect(balancePeriods(readings, [])).toEqual([]);
    expect(balanceUsageInWindow(readings, [], start, end)).toMatchObject({
      used: 30,
      measuredUsed: 30,
      openingBalance: null,
      closingBalance: null,
      creditUsed: null,
      complete: true,
    });
  });

  it("does not convert an acknowledged counter reset into measured zero consumption", () => {
    expect(
      balanceUsageInWindow(
        [
          { id: "opening", readingDate: start, value: null, cumulativeUsage: 22000 },
          { id: "closing", readingDate: end, value: null, cumulativeUsage: 21500 },
        ],
        [],
        start,
        end,
      ),
    ).toBeNull();
  });

  it("adds contiguous measured periods exactly once", () => {
    expect(
      intervalFlow(
        [
          { periodStart: start, periodEnd: middle, units: 10 },
          { periodStart: middle, periodEnd: end, units: 20 },
        ],
        start,
        end,
      ),
    ).toEqual({ units: 30, from: start, to: end });
  });

  it("does not add overlapping totals or invent usage in uncovered gaps", () => {
    expect(
      intervalFlow(
        [
          { periodStart: start, periodEnd: end, units: 30 },
          { periodStart: middle, periodEnd: end, units: 20 },
        ],
        start,
        end,
      ),
    ).toBeNull();
    expect(
      intervalFlow(
        [
          { periodStart: start, periodEnd: new Date("2026-01-10"), units: 10 },
          { periodStart: middle, periodEnd: end, units: 20 },
        ],
        start,
        end,
      ),
    ).toBeNull();
  });

  it("uses Nairobi time for explicit date-only imports and rejects ambiguous or impossible dates", () => {
    expect(importDate("2026-01-10")?.toISOString()).toBe("2026-01-09T21:00:00.000Z");
    expect(importDate("10/01/2026")).toBeNull();
    expect(importDate("2026-02-30")).toBeNull();
    expect(volumeFactor("litres")).toBe(0.001);
    expect(volumeFactor("gallons")).toBeNull();
  });
});
