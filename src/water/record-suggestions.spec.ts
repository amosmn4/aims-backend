import { describe, expect, it } from "@jest/globals";
import { matchSimilarity, suggestReadingValues } from "./record-suggestions";

describe("Record correction suggestions", () => {
  it("ranks a transposed digit as a near match without stripping leading zeroes", () => {
    expect(matchSimilarity("000123", "000132")).toBeCloseTo(5 / 6);
    expect(matchSimilarity("000123", "123")).toBe(0.5);
    expect(matchSimilarity("Mary Wanjikú", "mary wanjiku")).toBe(1);
  });

  it("suggests the nearest plausible digit correction for a decreasing bulk dial, with verification language", () => {
    const suggestions = suggestReadingValues({
      meterType: "bulk",
      readingDate: new Date("2026-01-02"),
      value: 21500,
      cumulativeUsage: null,
      purchasedUnits: 0,
      observations: [
        {
          id: "previous",
          readingDate: new Date("2026-01-01"),
          value: 22000,
          cumulativeUsage: null,
        },
      ],
    });
    expect(suggestions[0]).toMatchObject({ patch: { dialReading: 22500 }, confidence: "possible" });
    expect(suggestions[0].explanation).toContain("verify");
    expect(suggestions.every((item) => Number(item.patch.dialReading) >= 22000)).toBe(true);
  });

  it("suggests a decimal correction when usage greatly exceeds the recent median", () => {
    const suggestions = suggestReadingValues({
      meterType: "bulk",
      readingDate: new Date("2026-01-05"),
      value: 10400,
      cumulativeUsage: null,
      purchasedUnits: 0,
      observations: [1000, 1010, 1020, 1030].map((value, index) => ({
        id: String(index),
        readingDate: new Date("2026-01-0" + (index + 1)),
        value,
        cumulativeUsage: null,
      })),
    });
    expect(suggestions[0].patch).toEqual({ dialReading: 1040 });
  });

  it("keeps a normal falling household prepaid balance unchanged", () => {
    expect(
      suggestReadingValues({
        meterType: "household",
        readingDate: new Date("2026-01-02"),
        value: 15,
        cumulativeUsage: 105,
        purchasedUnits: 0,
        observations: [
          { id: "previous", readingDate: new Date("2026-01-01"), value: 20, cumulativeUsage: 100 },
        ],
      }),
    ).toEqual([]);
  });
});
