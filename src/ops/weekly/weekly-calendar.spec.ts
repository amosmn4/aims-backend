import { describe, expect, it } from "@jest/globals";
import {
  addDays,
  defaultWeeklySettings,
  nairobiDate,
  scheduleFor,
  weekOf,
} from "./weekly-calendar";

describe("Weekly reporting calendar", () => {
  const settings = { ...defaultWeeklySettings(), startWeek: "2026-11-16" };
  it("uses Nairobi dates at the UTC day boundary", () => {
    expect(nairobiDate(new Date("2026-11-15T22:00:00Z"))).toBe("2026-11-16");
    expect(weekOf(nairobiDate(new Date("2026-11-15T22:00:00Z")))).toBe("2026-11-16");
    expect(weekOf("2026-11-15")).toBe("2026-11-09");
  });
  it("keeps the plan and report schedules independent", () => {
    expect(scheduleFor("2026-11-16", "plan", settings).delivery.toISOString()).toBe(
      "2026-11-17T05:00:00.000Z",
    );
    expect(scheduleFor("2026-11-16", "report", settings).delivery.toISOString()).toBe(
      "2026-11-20T15:00:00.000Z",
    );
    const changed = { ...settings, planEmailDay: 3, planEmailTime: "09:30" };
    expect(scheduleFor("2026-11-16", "plan", changed).delivery.toISOString()).toBe(
      "2026-11-18T06:30:00.000Z",
    );
    expect(scheduleFor("2026-11-16", "report", changed)).toEqual(
      scheduleFor("2026-11-16", "report", settings),
    );
  });
  it("places delivery after the corresponding submission deadline", () => {
    expect(
      scheduleFor("2026-11-16", "report", {
        ...settings,
        reportEmailDay: 1,
      }).delivery.toISOString(),
    ).toBe("2026-11-23T15:00:00.000Z");
    expect(
      scheduleFor("2026-11-16", "report", {
        ...settings,
        reportEmailTime: "16:00",
      }).delivery.toISOString(),
    ).toBe("2026-11-27T13:00:00.000Z");
    expect(
      scheduleFor("2026-11-16", "report", {
        ...settings,
        reportDeadlineFollowingWeek: true,
        reportDeadlineDay: 1,
        reportEmailDay: 2,
      }).delivery.toISOString(),
    ).toBe("2026-11-24T15:00:00.000Z");
  });
  it("handles year and leap-day boundaries", () => {
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
