import { describe, expect, it } from "@jest/globals";
import { delegationWeek, forwardTaskPeriod } from "./task-planning";

describe("Forwarding and delegation periods", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  it("moves an overdue task to next week and preserves its due weekday", () => {
    expect(forwardTaskPeriod({ weekStart: "2026-11-02", due: "2026-11-06" }, now)).toEqual({
      weekStart: "2026-11-30",
      due: "2026-12-04",
    });
  });
  it("moves a current or future task forward one week", () => {
    expect(forwardTaskPeriod({ due: "2026-11-25" }, now)).toEqual({
      weekStart: "2026-11-30",
      due: "2026-12-02",
    });
    expect(forwardTaskPeriod({ weekStart: "2026-11-30", due: "2026-12-01" }, now)).toEqual({
      weekStart: "2026-12-07",
      due: "2026-12-08",
    });
  });
  it("accepts overdue work into the current Nairobi week and retains future periods", () => {
    expect(delegationWeek("2026-11-02", now)).toBe("2026-11-23");
    expect(delegationWeek("2026-11-30", now)).toBe("2026-11-30");
    expect(delegationWeek(null, new Date("2026-11-29T21:01:00Z"))).toBe("2026-11-30");
  });
});
