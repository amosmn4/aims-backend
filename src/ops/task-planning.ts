import { addDays, nairobiDate, weekOf } from "./weekly/weekly-calendar";

export function forwardTaskPeriod(task: { weekStart?: string | null; due: string }, now: Date) {
  const current = weekOf(nairobiDate(now));
  const original = task.weekStart ?? weekOf(task.due);
  const weekStart = addDays(original < current ? current : original, 7);
  const weekday = (new Date(`${task.due}T12:00:00Z`).getUTCDay() + 6) % 7;
  return { weekStart, due: addDays(weekStart, weekday) };
}

export function delegationWeek(period: string | null | undefined, now: Date) {
  const current = weekOf(nairobiDate(now));
  return period && period >= current ? period : current;
}
