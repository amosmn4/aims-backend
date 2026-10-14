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

  it("allocates only the part of each reading interval inside the window", () => {
    const res = balanceUsageInWindow(
      readings,
      [{ recordedAt: d("2026-09-20T09:00:00Z"), units: 4 }],
      d("2026-09-01T00:00:00Z"),
      d("2026-10-01T00:00:00Z"),
    );
    expect(res?.used).toBe(16.79);
    expect(res?.estimated).toBe(true);
    expect(res?.complete).toBe(false);
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

describe("Cumulative household usage and prepaid credit", () => {
  const capture = (id: string, at: string, balance: number, counter: number | null) => ({
    ...r(id, at, balance),
    cumulativeUsage: counter,
  });

  it("measures 519 to 525 as six cubic metres, separately from ten units falling to four", () => {
    const [period] = balancePeriods(
      [capture("a", "2026-10-13T09:00:00Z", 10, 519), capture("b", "2026-10-14T09:00:00Z", 4, 525)],
      [],
    );
    expect(period).toMatchObject({
      used: 6,
      measuredUsed: 6,
      creditUsed: 6,
      difference: 0,
      flags: [],
    });
  });

  it("reconciles fifty purchased units and twenty remaining with thirty units of lifetime-counter usage", () => {
    const result = balanceUsageInWindow(
      [capture("a", "2026-10-01T00:00:00Z", 0, 519), capture("b", "2026-11-01T00:00:00Z", 20, 549)],
      [{ recordedAt: d("2026-10-15T00:00:00Z"), units: 50 }],
      d("2026-10-01T00:00:00Z"),
      d("2026-11-01T00:00:00Z"),
    );
    expect(result).toMatchObject({
      used: 30,
      measuredUsed: 30,
      creditUsed: 30,
      purchased: 50,
      openingBalance: 0,
      closingBalance: 20,
      difference: 0,
      complete: true,
      estimated: false,
    });
  });

  it("includes opening prepaid credit so purchases minus usage is not mistaken for the remaining balance", () => {
    const [period] = balancePeriods(
      [capture("a", "2026-10-01", 20, 519), capture("b", "2026-11-01", 40, 549)],
      [{ recordedAt: d("2026-10-15"), units: 50 }],
    );
    expect(period).toMatchObject({
      openingBalance: 20,
      purchased: 50,
      closingBalance: 40,
      used: 30,
      measuredUsed: 30,
      creditUsed: 30,
      difference: 0,
    });
  });

  it("flags mismatched credit without replacing the measured consumption with purchases", () => {
    const [period] = balancePeriods(
      [capture("a", "2026-10-13", 10, 519), capture("b", "2026-10-14", 3, 525)],
      [],
    );
    expect(period).toMatchObject({
      used: 6,
      measuredUsed: 6,
      creditUsed: 7,
      difference: -1,
      flags: ["usage_mismatch"],
    });
  });

  it("does not invent a usage counter for legacy credit-only readings", () => {
    const [period] = balancePeriods(
      [capture("a", "2026-10-13", 10, null), capture("b", "2026-10-14", 4, 525)],
      [],
    );
    expect(period).toMatchObject({ used: 6, measuredUsed: null, creditUsed: 6, difference: null });
  });

  it("flags counter resets and does not report their negative movement as measured zero use", () => {
    const readings = [capture("a", "2026-10-13", 10, 519), capture("b", "2026-10-14", 4, 5)];
    expect(balancePeriods(readings, [])[0].flags).toContain("counter_decreased");
    expect(balanceUsageInWindow(readings, [], d("2026-10-01"), d("2026-11-01"))).toBeNull();
  });

  it("splits straddling intervals once so monthly usage sums to the lifetime movement", () => {
    const readings = [capture("a", "2026-09-30", 12, 519), capture("b", "2026-10-02", 0, 531)];
    const september = balanceUsageInWindow(readings, [], d("2026-09-01"), d("2026-10-01"));
    const october = balanceUsageInWindow(readings, [], d("2026-10-01"), d("2026-11-01"));
    expect(september?.used).toBe(6);
    expect(october?.used).toBe(6);
    expect(october?.openingBalance).toBe(6);
    expect(october?.estimated).toBe(true);
    expect(october?.complete).toBe(false);
  });

  it("keeps a top-up at the month boundary in the following month's credit reconciliation", () => {
    const readings = [
      capture("a", "2026-10-01", 0, 519),
      capture("b", "2026-11-01", 25, 549),
      capture("c", "2026-12-01", 5, 569),
    ];
    const purchases = [
      { recordedAt: d("2026-10-15"), units: 50 },
      { recordedAt: d("2026-11-01"), units: 5 },
    ];
    const october = balanceUsageInWindow(readings, purchases, d("2026-10-01"), d("2026-11-01"));
    const november = balanceUsageInWindow(readings, purchases, d("2026-11-01"), d("2026-12-01"));
    expect(october).toMatchObject({
      purchased: 50,
      closingBalance: 20,
      measuredUsed: 30,
      creditUsed: 30,
    });
    expect(november).toMatchObject({
      openingBalance: 20,
      purchased: 5,
      closingBalance: 5,
      measuredUsed: 20,
      creditUsed: 20,
    });
  });
});

describe("Independent counter and prepaid histories", () => {
  const readings = [
    { id: "a", readingDate: d("2026-10-01"), value: 0, cumulativeUsage: 519 },
    { id: "credit-only", readingDate: d("2026-10-15"), value: 35, cumulativeUsage: null },
    { id: "b", readingDate: d("2026-11-01"), value: 20, cumulativeUsage: 549 },
  ];
  it("uses known monthly counter bookends despite an older credit-only capture between them", () => {
    const result = balanceUsageInWindow(
      readings,
      [{ recordedAt: d("2026-10-10"), units: 50 }],
      d("2026-10-01"),
      d("2026-11-01"),
    );
    expect(result).toMatchObject({
      used: 30,
      measuredUsed: 30,
      creditUsed: 30,
      difference: 0,
      estimated: false,
      complete: true,
    });
  });
  it("retains measured usage and flags missing purchases instead of overriding it with credit-derived usage", () => {
    const result = balanceUsageInWindow(
      readings.map((reading) => ({
        ...reading,
        value: reading.id === "credit-only" ? 10 : reading.value,
      })),
      [{ recordedAt: d("2026-10-10"), units: 25 }],
      d("2026-10-01"),
      d("2026-11-01"),
    );
    expect(result).toMatchObject({ used: 30, measuredUsed: 30, creditUsed: 5, difference: 25 });
    expect(result?.issues).toBeGreaterThan(0);
  });
  it("detects counter decreases across intervening credit-only captures", () => {
    const periods = balancePeriods(
      readings.map((reading) => ({
        ...reading,
        cumulativeUsage: reading.id === "b" ? 5 : reading.cumulativeUsage,
      })),
      [{ recordedAt: d("2026-10-10"), units: 50 }],
    );
    expect(periods.at(-1)?.flags).toContain("counter_decreased");
  });
});
