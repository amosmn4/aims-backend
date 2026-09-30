import { describe, expect, it } from "@jest/globals";
import { dialFlow, type DialReading } from "./meter-flow";

const r = (date: string, value: number): DialReading => ({ at: new Date(date), value });
const AUG = [new Date("2026-08-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z")] as const;
const SEP = [new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")] as const;
const none = { before: null, first: null, last: null, after: null };

describe("dialFlow", () => {
  it("needs two readings that bound part of the period", () => {
    expect(dialFlow(none, ...AUG)).toBeNull();
    const only = r("2026-08-10T06:00:00Z", 500);
    expect(dialFlow({ ...none, first: only, last: only }, ...AUG)).toBeNull();
  });

  it("uses the readings inside the period when nothing surrounds them", () => {
    const flow = dialFlow(
      { ...none, first: r("2026-08-10T06:00:00Z", 100), last: r("2026-08-20T06:00:00Z", 729) },
      ...AUG,
    );
    expect(flow?.units).toBe(629);
    expect(flow?.from.toISOString()).toBe("2026-08-10T06:00:00.000Z");
    expect(flow?.to.toISOString()).toBe("2026-08-20T06:00:00.000Z");
  });

  it("does not hand last month's water to this month", () => {
    // Read on the 1st of each month: August's 500 must not land in September.
    const jul1 = r("2026-07-01T00:00:00Z", 0);
    const aug1 = r("2026-08-01T00:00:00Z", 310);
    const sep1 = r("2026-09-01T00:00:00Z", 810);
    const oct1 = r("2026-10-01T00:00:00Z", 1710);
    const aug = dialFlow({ before: jul1, first: aug1, last: aug1, after: sep1 }, ...AUG);
    const sep = dialFlow({ before: aug1, first: sep1, last: sep1, after: oct1 }, ...SEP);
    expect(aug?.units).toBeCloseTo(500, 5);
    expect(sep?.units).toBeCloseTo(900, 5);
  });

  it("splits a gap that straddles the month end by its days", () => {
    // 300 units over 30 days from 22 Aug to 21 Sep: 10 days fall in August.
    const flow = dialFlow(
      {
        before: null,
        first: r("2026-08-02T00:00:00Z", 1000),
        last: r("2026-08-22T00:00:00Z", 1200),
        after: r("2026-09-21T00:00:00Z", 1500),
      },
      ...AUG,
    );
    expect(flow?.units).toBeCloseTo(300, 5);
    expect(flow?.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("adds up across months to the dial's total movement", () => {
    const a = r("2026-07-20T00:00:00Z", 0);
    const b = r("2026-08-15T00:00:00Z", 400);
    const c = r("2026-09-25T00:00:00Z", 1300);
    const aug = dialFlow({ before: a, first: b, last: b, after: c }, ...AUG)!;
    const sep = dialFlow({ before: b, first: c, last: c, after: null }, ...SEP)!;
    const julTail = valueBetween(a, b, AUG[0]);
    expect(julTail + aug.units + sep.units).toBeCloseTo(1300, 5);
  });

  it("never reports a dial going backwards", () => {
    const flow = dialFlow(
      { ...none, first: r("2026-08-05T00:00:00Z", 900), last: r("2026-08-25T00:00:00Z", 100) },
      ...AUG,
    );
    expect(flow?.units).toBe(0);
  });
});

function valueBetween(a: DialReading, b: DialReading, at: Date): number {
  const share = (at.getTime() - a.at.getTime()) / (b.at.getTime() - a.at.getTime());
  return a.value + (b.value - a.value) * share;
}
