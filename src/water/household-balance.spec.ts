import { describe, expect, it } from "@jest/globals";
import { balancePeriods, balanceUsageInWindow } from "./household-balance";

const d = (s: string) => new Date(s);
const r = (id: string, date: string, value: number) => ({ id, readingDate: d(date), value });

describe("balancePeriods", () => {
  it("adds purchases between readings to the opening balance", () => {
    const [p] = balancePeriods(
      [r("a", "2026-09-01T09:00:00Z", 12), r("b", "2026-10-01T09:00:00Z", 8.5)],
      [{ recordedAt: d("2026-09-10T12:00:00Z"), units: 20 }],
    );
    expect(p.used).toBe(23.5);
    expect(p.days).toBe(30);
    expect(p.perDay).toBeCloseTo(0.78, 2);
    expect(p.flags).toEqual([]);
  });

  it("counts a purchase made after a reading in the next period only", () => {
    const periods = balancePeriods(
      [
        r("a", "2026-09-01T09:00:00Z", 10),
        r("b", "2026-10-01T09:00:00Z", 5),
        r("c", "2026-11-01T09:00:00Z", 12),
      ],
      [{ recordedAt: d("2026-10-01T15:00:00Z"), units: 15 }],
    );
    expect(periods.map((p) => p.used)).toEqual([5, 8]);
  });

  it("flags a balance that rose without a purchase", () => {
    const [p] = balancePeriods(
      [r("a", "2026-09-01T09:00:00Z", 5), r("b", "2026-10-01T09:00:00Z", 9)],
      [],
    );
    expect(p.used).toBe(-4);
    expect(p.flags).toEqual(["balance_too_high"]);
  });

  it("flags no use over a long period", () => {
    const [p] = balancePeriods(
      [r("a", "2026-09-01T09:00:00Z", 7), r("b", "2026-10-01T09:00:00Z", 7)],
      [],
    );
    expect(p.flags).toEqual(["no_use"]);
  });

  it("flags use above twice the household's usual once it has a baseline", () => {
    const readings = [
      r("a", "2026-03-01T09:00:00Z", 100),
      r("b", "2026-03-31T09:00:00Z", 88),
      r("c", "2026-04-30T09:00:00Z", 76),
      r("d", "2026-05-30T09:00:00Z", 64),
      r("e", "2026-06-29T09:00:00Z", 30),
    ];
    const periods = balancePeriods(readings, []);
    expect(periods.slice(0, 3).every((p) => p.flags.length === 0)).toBe(true);
    expect(periods[3].baselinePerDay).toBe(0.4);
    expect(periods[3].flags).toEqual(["high_use"]);
  });
});

describe("balanceUsageInWindow", () => {
  const readings = [
    r("a", "2026-08-28T09:00:00Z", 20),
    r("b", "2026-09-15T09:00:00Z", 14),
    r("c", "2026-09-29T09:00:00Z", 6),
  ];

  it("opens from the last reading before the window", () => {
    const res = balanceUsageInWindow(
      readings,
      [{ recordedAt: d("2026-09-20T09:00:00Z"), units: 4 }],
      d("2026-09-01T00:00:00Z"),
      d("2026-10-01T00:00:00Z"),
    );
    expect(res?.used).toBe(18);
  });

  it("returns null with only one reading to work from", () => {
    expect(
      balanceUsageInWindow(
        [r("a", "2026-09-15T09:00:00Z", 14)],
        [],
        d("2026-09-01T00:00:00Z"),
        d("2026-10-01T00:00:00Z"),
      ),
    ).toBeNull();
  });
});
