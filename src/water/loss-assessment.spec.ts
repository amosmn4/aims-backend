import { describe, expect, it } from "@jest/globals";
import {
  assessGap,
  estimateFromHistory,
  gapNote,
  riseNote,
  roseSharply,
  type HouseholdSide,
} from "./loss-assessment";

const d = (s: string) => new Date(s);
const tokens = (taken: number, expected: number | null = null, carried = 0): HouseholdSide => ({
  taken,
  basis: "tokens",
  expected,
  carried,
});
const assess = (passed: number, household: HouseholdSide, adjustments = 0) =>
  assessGap({ measured: true, passed, adjustments, household });

describe("estimateFromHistory", () => {
  it("predicts use from the daily average of earlier purchases", () => {
    // 90 units over 90 days is 1 a day, so a 10-day window expects 10.
    const history = [
      { recordedAt: d("2026-06-03"), units: 30 },
      { recordedAt: d("2026-07-10"), units: 30 },
      { recordedAt: d("2026-08-05"), units: 30 },
    ];
    const est = estimateFromHistory(history, d("2026-09-01"), d("2026-09-11"));
    expect(est.expected).toBeCloseTo(10, 5);
    expect(est.carried).toBe(0);
  });

  it("counts a recent bulk purchase beyond typical use as carried credit", () => {
    const history = [
      { recordedAt: d("2026-06-03"), units: 30 },
      { recordedAt: d("2026-07-05"), units: 30 },
      { recordedAt: d("2026-08-25"), units: 120 },
    ];
    // 180 over 90 days is 2 a day; the last 30 days saw 120 against a typical 60.
    const est = estimateFromHistory(history, d("2026-09-01"), d("2026-10-01"));
    expect(est.expected).toBeCloseTo(60, 5);
    expect(est.carried).toBeCloseTo(60, 5);
  });

  it("makes no prediction from too little history", () => {
    const history = [{ recordedAt: d("2026-08-28"), units: 50 }];
    expect(estimateFromHistory(history, d("2026-09-01"), d("2026-10-01"))).toEqual({
      expected: null,
      carried: 0,
    });
    expect(estimateFromHistory([], d("2026-09-01"), d("2026-10-01")).expected).toBeNull();
  });
});

describe("assessGap", () => {
  it("does not judge a meter that was not read twice", () => {
    const a = assessGap({ measured: false, passed: 0, adjustments: 0, household: tokens(300) });
    expect(a.verdict).toBe("not_measured");
    expect(a.gapPct).toBeNull();
  });

  it("calls more bought than passed credit, not a negative loss", () => {
    // The main meter passed 629 and households bought 655.
    const a = assess(629, tokens(655));
    expect(a.verdict).toBe("bought_ahead");
    expect(a.gap).toBe(-26);
  });

  it("flags measured use above what was passed as a reading problem", () => {
    expect(assess(100, { taken: 120, basis: "readings", expected: null, carried: 0 }).verdict).toBe(
      "over_read",
    );
  });

  it("treats a small gap as within the allowance for pipes and rounding", () => {
    expect(assess(500, tokens(470)).verdict).toBe("within_limit");
  });

  it("holds back when typical use or carried credit could explain the gap", () => {
    // Passed 900, bought 500, but households typically use 700 and carried 150.
    const a = assess(900, tokens(500, 700, 150));
    expect(a.gap).toBe(400);
    expect(a.unexplained).toBe(50);
    expect(a.verdict).toBe("possible_loss");
  });

  it("calls it a likely loss when even the generous estimate falls short", () => {
    // Zone shot from 500 to 900; purchases and leftover credit do not rhyme.
    const a = assess(900, tokens(480, 520, 40));
    expect(a.unexplained).toBe(340);
    expect(a.verdict).toBe("likely_loss");
  });

  it("trusts read balances outright", () => {
    const a = assess(900, { taken: 600, basis: "readings", expected: 850, carried: 100 });
    expect(a.verdict).toBe("likely_loss");
  });

  it("counts written-down volumes as accounted for", () => {
    expect(assess(900, tokens(480, 520, 40), 360).verdict).toBe("within_limit");
  });
});

describe("notes", () => {
  it("explains a likely loss with what was allowed for", () => {
    const household = tokens(480, 520, 40);
    const note = gapNote({
      what: "Zone 2's bulk meter",
      from: d("2026-08-01T06:00:00Z"),
      to: d("2026-08-30T06:00:00Z"),
      passed: 900,
      household,
      assessment: assess(900, household),
    });
    expect(note).toContain("Between 1 Aug and 30 Aug");
    expect(note).toContain("a gap of 420 m³ (46.7%)");
    expect(note).toContain("340 m³ (37.8%) is not explained");
  });

  it("only reports a rise that is real per day", () => {
    expect(roseSharply({ units: 900, days: 30 }, { units: 500, days: 30 })).toBe(true);
    expect(roseSharply({ units: 900, days: 30 }, { units: 450, days: 15 })).toBe(false);
    expect(roseSharply({ units: 520, days: 30 }, { units: 500, days: 30 })).toBe(false);
  });

  it("says when purchases do not explain a rise", () => {
    const note = riseNote({
      what: "Zone 2's bulk meter",
      now: { units: 900, days: 30 },
      before: { units: 500, days: 30 },
      taken: 480,
      takenBefore: 470,
      basis: "tokens",
      verdict: "likely_loss",
    });
    expect(note).toContain("rose from 500 m³ to 900 m³");
    expect(note).toContain("do not explain the rise");
  });
});
