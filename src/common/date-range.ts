// Date-only filters ("2026-09-15") mean a whole day in the company's time zone (Nairobi, UTC+3).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const COMPANY_OFFSET = "+03:00";

/** Start of a date-only filter's day in company time; full timestamps pass through. */
export function startOfDay(value: string | Date): Date {
  if (typeof value === "string" && DATE_ONLY.test(value))
    return new Date(`${value}T00:00:00.000${COMPANY_OFFSET}`);
  return new Date(value);
}

/** End of a date-only filter's day in company time, so that whole day is included. */
export function endOfDay(value: string | Date): Date {
  if (typeof value === "string" && DATE_ONLY.test(value))
    return new Date(`${value}T23:59:59.999${COMPANY_OFFSET}`);
  return new Date(value);
}
