import type { WeeklyPhase, WeeklySettings } from "./weekly.schemas";

export const REPORTING_TIMEZONE = "Africa/Nairobi";
export function nairobiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function weekOf(date = nairobiDate()) {
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function defaultWeeklySettings(): WeeklySettings {
  return {
    startWeek: weekOf(),
    planDeadlineDay: 1,
    planDeadlineTime: "17:00",
    planEmailDay: 2,
    planEmailTime: "08:00",
    planEmailEnabled: false,
    reportDeadlineDay: 5,
    reportDeadlineTime: "17:00",
    reportDeadlineFollowingWeek: false,
    reportEmailDay: 5,
    reportEmailTime: "18:00",
    reportEmailEnabled: false,
  };
}
export function scheduleFor(week: string, phase: WeeklyPhase, settings: WeeklySettings) {
  const plan = phase === "plan";
  const following = !plan && settings.reportDeadlineFollowingWeek ? 7 : 0;
  const dueDay = plan ? settings.planDeadlineDay : settings.reportDeadlineDay;
  const dueTime = plan ? settings.planDeadlineTime : settings.reportDeadlineTime;
  const emailDay = plan ? settings.planEmailDay : settings.reportEmailDay;
  const emailTime = plan ? settings.planEmailTime : settings.reportEmailTime;
  const deadline = new Date(`${addDays(week, dueDay - 1 + following)}T${dueTime}:00+03:00`);
  let delivery = new Date(`${addDays(week, emailDay - 1 + following)}T${emailTime}:00+03:00`);
  if (delivery < deadline) delivery = new Date(delivery.getTime() + 7 * 86400000);
  return {
    deadline,
    delivery,
    enabled: plan ? settings.planEmailEnabled : settings.reportEmailEnabled,
  };
}
export function phaseCounts(items: WeeklySubmissionItems) {
  return items.reduce<Record<string, number>>(
    (counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }),
    {},
  );
}
type WeeklySubmissionItems = { status: string }[];
