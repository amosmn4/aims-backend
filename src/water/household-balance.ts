// Prepaid household meters: a reading is the credit balance left, so
// used = previous balance + units bought since − balance now.

export type BalanceReading = { id: string; readingDate: Date; value: number };
export type BalancePurchase = { recordedAt: Date; units: number };
export type BalanceFlag = "balance_too_high" | "no_use" | "high_use";

export type BalancePeriod = {
  readingId: string;
  from: Date;
  to: Date;
  openingBalance: number;
  purchased: number;
  closingBalance: number;
  /** Negative means the balance rose more than purchases explain. */
  used: number;
  days: number;
  perDay: number | null;
  baselinePerDay: number | null;
  flags: BalanceFlag[];
};

/** Meter displays round, so tiny differences are not treated as anomalies. */
export const BALANCE_TOLERANCE = 0.1;
export const NO_USE_MIN_DAYS = 20;
export const HIGH_USE_FACTOR = 2;
const BASELINE_MIN_PERIODS = 3;
const BASELINE_MAX_PERIODS = 6;
const DAY_MS = 86_400_000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Units bought after `after` and up to and including `upTo`. */
export function purchasedBetween(purchases: BalancePurchase[], after: Date, upTo: Date) {
  return purchases.reduce(
    (sum, p) => (p.recordedAt > after && p.recordedAt <= upTo ? sum + p.units : sum),
    0,
  );
}

/** One period per pair of consecutive readings, oldest first, with anomaly flags. */
export function balancePeriods(
  readings: BalanceReading[],
  purchases: BalancePurchase[],
): BalancePeriod[] {
  const sorted = [...readings].sort((a, b) => a.readingDate.getTime() - b.readingDate.getTime());
  const periods: BalancePeriod[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const purchased = purchasedBetween(purchases, prev.readingDate, cur.readingDate);
    const used = prev.value + purchased - cur.value;
    const days = (cur.readingDate.getTime() - prev.readingDate.getTime()) / DAY_MS;
    const perDay = days >= 1 ? used / days : null;

    const history = periods
      .filter((p) => p.flags.length === 0 && p.perDay != null && p.perDay > 0)
      .slice(-BASELINE_MAX_PERIODS)
      .map((p) => p.perDay!);
    const baselinePerDay = history.length >= BASELINE_MIN_PERIODS ? median(history) : null;

    const flags: BalanceFlag[] = [];
    if (used < -BALANCE_TOLERANCE) flags.push("balance_too_high");
    else if (days >= NO_USE_MIN_DAYS && used <= BALANCE_TOLERANCE) flags.push("no_use");
    else if (baselinePerDay && perDay != null && perDay > HIGH_USE_FACTOR * baselinePerDay) {
      flags.push("high_use");
    }

    periods.push({
      readingId: cur.id,
      from: prev.readingDate,
      to: cur.readingDate,
      openingBalance: prev.value,
      purchased: round2(purchased),
      closingBalance: cur.value,
      used: round2(used),
      days: round2(days),
      perDay: perDay == null ? null : round2(perDay),
      baselinePerDay: baselinePerDay == null ? null : round2(baselinePerDay),
      flags,
    });
  }
  return periods;
}

/**
 * Units used in [start, end): opening is the last reading before `start`
 * (else the first inside), closing the last inside. Null when not measurable.
 */
export function balanceUsageInWindow(
  readings: BalanceReading[],
  purchases: BalancePurchase[],
  start: Date,
  end: Date,
): { used: number; openedAt: Date } | null {
  const sorted = [...readings].sort((a, b) => a.readingDate.getTime() - b.readingDate.getTime());
  const before = sorted.filter((r) => r.readingDate < start);
  const inside = sorted.filter((r) => r.readingDate >= start && r.readingDate < end);
  if (inside.length === 0) return null;
  const opening = before.length > 0 ? before[before.length - 1] : inside[0];
  const closing = inside[inside.length - 1];
  if (opening === closing) return null;
  const used =
    opening.value +
    purchasedBetween(purchases, opening.readingDate, closing.readingDate) -
    closing.value;
  return { used: Math.max(0, used), openedAt: opening.readingDate };
}
