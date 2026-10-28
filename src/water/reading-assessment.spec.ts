import { describe, expect, it } from "@jest/globals";
import {
  assessReading,
  type ReadingAssessmentInput,
  type ReadingObservation,
} from "./reading-assessment";

const observation = (
  day: number,
  value: number | null,
  cumulativeUsage: number | null = null,
): ReadingObservation => ({
  id: `reading-${day}`,
  readingDate: new Date(`2026-01-${String(day).padStart(2, "0")}T09:00:00Z`),
  value,
  cumulativeUsage,
});
const input = (overrides: Partial<ReadingAssessmentInput> = {}): ReadingAssessmentInput => ({
  meterType: "bulk",
  readingDate: new Date("2026-01-10T09:00:00Z"),
  value: 21500,
  cumulativeUsage: null,
  observations: [observation(9, 22000)],
  purchasedUnits: 0,
  now: new Date("2026-01-10T12:00:00Z"),
  ...overrides,
});

describe("Water reading history assessment", () => {
  it("warns in red when yesterday's 22000 becomes 21500", () => {
    expect(assessReading(input())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "counter_decreased",
          severity: "danger",
          message: expect.stringContaining("22000"),
        }),
      ]),
    );
  });

  it("accepts a normal increasing bulk dial without warnings", () => {
    expect(assessReading(input({ value: 22100 }))).toEqual([]);
  });

  it("compares a backdated entry against the later reading", () => {
    expect(
      assessReading(
        input({ value: 23000, observations: [observation(9, 22000), observation(11, 22500)] }),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "above_later_reading" })]));
  });

  it("treats a falling prepaid balance with matching consumption as normal", () => {
    expect(
      assessReading(
        input({
          meterType: "household",
          value: 7,
          cumulativeUsage: 103,
          observations: [observation(9, 10, 100)],
        }),
      ),
    ).toEqual([]);
  });

  it("accounts for top-ups before checking household balances", () => {
    expect(
      assessReading(
        input({
          meterType: "household",
          value: 12,
          cumulativeUsage: 103,
          purchasedUnits: 5,
          observations: [observation(9, 10, 100)],
        }),
      ),
    ).toEqual([]);
  });

  it("detects an unexplained prepaid balance increase", () => {
    expect(
      assessReading(
        input({
          meterType: "household",
          value: 12,
          cumulativeUsage: null,
          observations: [observation(9, 10, 100)],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unexplained_credit_increase" })]),
    );
  });

  it("checks household lifetime counters independently from missing balances", () => {
    expect(
      assessReading(
        input({
          meterType: "household",
          value: null,
          cumulativeUsage: 99,
          observations: [observation(9, null, 100)],
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "counter_decreased" })]));
  });

  it("detects usage spikes against the meter's own median daily usage", () => {
    expect(
      assessReading(
        input({
          value: 1000,
          observations: [
            observation(6, 100),
            observation(7, 110),
            observation(8, 120),
            observation(9, 130),
          ],
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unusually_high_usage" })]));
  });

  it("normalizes consumption by elapsed time instead of warning on a longer interval", () => {
    expect(
      assessReading(
        input({
          readingDate: new Date("2026-01-20T09:00:00Z"),
          now: new Date("2026-01-21T00:00:00Z"),
          value: 240,
          observations: [
            observation(6, 100),
            observation(7, 110),
            observation(8, 120),
            observation(9, 130),
          ],
        }),
      ),
    ).toEqual([]);
  });
});
