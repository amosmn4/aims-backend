import { dialFlow } from "./meter-flow";

// Prepaid household meters: a reading is the credit balance left, so
// used = previous balance + units bought since − balance now.

export type BalanceReading = {
  id: string;
  readingDate: Date;
  value: number;
  cumulativeUsage?: number | null;
};
export type BalancePurchase = { recordedAt: Date; units: number };
export type BalanceFlag =
  "balance_too_high" | "counter_decreased" | "usage_mismatch" | "no_use" | "high_use";

export type BalancePeriod = {
  readingId: string;
  from: Date;
  to: Date;
  openingBalance: number;
  purchased: number;
  closingBalance: number;
  openingCumulativeUsage: number | null;
  closingCumulativeUsage: number | null;
  measuredUsed: number | null;
  creditUsed: number;
  difference: number | null;
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
  let lastKnownCounter = sorted[0]?.cumulativeUsage ?? null;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const purchased = purchasedBetween(purchases, prev.readingDate, cur.readingDate);
    const creditUsed = prev.value + purchased - cur.value;
    const counterDelta =
      prev.cumulativeUsage != null && cur.cumulativeUsage != null
        ? cur.cumulativeUsage - prev.cumulativeUsage
        : null;
    const measuredUsed = counterDelta !== null && counterDelta >= 0 ? counterDelta : null;
    const used = measuredUsed ?? creditUsed;
    const difference = measuredUsed === null ? null : measuredUsed - creditUsed;
    const days = (cur.readingDate.getTime() - prev.readingDate.getTime()) / DAY_MS;
    const perDay = days >= 1 ? used / days : null;

    const history = periods
      .filter((p) => p.flags.length === 0 && p.perDay != null && p.perDay > 0)
      .slice(-BASELINE_MAX_PERIODS)
      .map((p) => p.perDay!);
    const baselinePerDay = history.length >= BASELINE_MIN_PERIODS ? median(history) : null;

    const flags: BalanceFlag[] = [];
    if (
      cur.cumulativeUsage != null &&
      lastKnownCounter !== null &&
      cur.cumulativeUsage < lastKnownCounter
    )
      flags.push("counter_decreased");
    if (cur.cumulativeUsage != null) lastKnownCounter = cur.cumulativeUsage;
    if (creditUsed < -BALANCE_TOLERANCE) flags.push("balance_too_high");
    if (difference !== null && Math.abs(difference) > BALANCE_TOLERANCE)
      flags.push("usage_mismatch");
    if (flags.length === 0 && days >= NO_USE_MIN_DAYS && used <= BALANCE_TOLERANCE)
      flags.push("no_use");
    else if (
      flags.length === 0 &&
      baselinePerDay &&
      perDay != null &&
      perDay > HIGH_USE_FACTOR * baselinePerDay
    ) {
      flags.push("high_use");
    }

    periods.push({
      readingId: cur.id,
      from: prev.readingDate,
      to: cur.readingDate,
      openingBalance: prev.value,
      purchased: round2(purchased),
      closingBalance: cur.value,
      openingCumulativeUsage: prev.cumulativeUsage ?? null,
      closingCumulativeUsage: cur.cumulativeUsage ?? null,
      measuredUsed: measuredUsed === null ? null : round2(measuredUsed),
      creditUsed: round2(creditUsed),
      difference: difference === null ? null : round2(difference),
      used: round2(used),
      days: round2(days),
      perDay: perDay == null ? null : round2(perDay),
      baselinePerDay: baselinePerDay == null ? null : round2(baselinePerDay),
      flags,
    });
  }
  return periods;
}

export function balanceUsageInWindow(
  readings: BalanceReading[],
  purchases: BalancePurchase[],
  start: Date,
  end: Date,
) {
  const periods = balancePeriods(readings, purchases);
  const matching = periods.filter(
    (period) => period.to > start && period.from < end && period.to > period.from,
  );
  if (matching.length === 0) return null;
  const slices = matching.map((period) => {
    const from = new Date(Math.max(start.getTime(), period.from.getTime()));
    const to = new Date(Math.min(end.getTime(), period.to.getTime()));
    const span = period.to.getTime() - period.from.getTime();
    const fraction = (to.getTime() - from.getTime()) / span;
    const balanceAt = (at: Date) =>
      period.openingBalance +
      purchasedBetween(purchases, period.from, at) -
      (period.creditUsed * (at.getTime() - period.from.getTime())) / span;
    return {
      period,
      from,
      to,
      fraction,
      openingBalance:
        balanceAt(from) -
        (from.getTime() === start.getTime()
          ? purchases
              .filter((purchase) => purchase.recordedAt.getTime() === from.getTime())
              .reduce((sum, purchase) => sum + purchase.units, 0)
          : 0),
      closingBalance:
        balanceAt(to) -
        (to.getTime() === end.getTime()
          ? purchases
              .filter((purchase) => purchase.recordedAt.getTime() === to.getTime())
              .reduce((sum, purchase) => sum + purchase.units, 0)
          : 0),
    };
  });
  if (slices.some(({ period }) => period.flags.includes("counter_decreased"))) return null;
  const from = slices[0].from;
  const to = slices[slices.length - 1].to;
  const counters = readings
    .filter((reading) => reading.cumulativeUsage != null)
    .sort((a, b) => a.readingDate.getTime() - b.readingDate.getTime());
  const before = counters.filter((reading) => reading.readingDate < from).at(-1) ?? null;
  const inside = counters.filter(
    (reading) => reading.readingDate >= from && reading.readingDate < to,
  );
  const after = counters.find((reading) => reading.readingDate >= to) ?? null;
  const counter = (reading: BalanceReading | null) =>
    reading && { at: reading.readingDate, value: reading.cumulativeUsage! };
  const flow = dialFlow(
    {
      before: counter(before),
      first: counter(inside[0] ?? null),
      last: counter(inside.at(-1) ?? null),
      after: counter(after),
    },
    from,
    to,
  );
  const comparable =
    flow && flow.from.getTime() <= from.getTime() + 1 && flow.to.getTime() >= to.getTime() - 1;
  const measuredUsed = comparable ? round2(flow.units) : null;
  if (measuredUsed === null && slices.some(({ period }) => period.used < 0)) return null;
  const counterEstimated =
    measuredUsed !== null &&
    (!counters.some((reading) => reading.readingDate.getTime() === from.getTime()) ||
      !counters.some((reading) => reading.readingDate.getTime() === to.getTime()));
  const creditUsed = round2(
    slices.reduce((sum, slice) => sum + slice.period.creditUsed * slice.fraction, 0),
  );
  const intervalIssues = slices.filter(
    ({ period }) =>
      period.flags.includes("usage_mismatch") || period.flags.includes("balance_too_high"),
  ).length;
  return {
    used:
      measuredUsed ??
      round2(slices.reduce((sum, slice) => sum + slice.period.used * slice.fraction, 0)),
    openedAt: from,
    closedAt: to,
    complete: from.getTime() <= start.getTime() + 1 && to.getTime() >= end.getTime() - 1,
    estimated: counterEstimated || slices.some((slice) => slice.fraction !== 1),
    openingBalance: round2(slices[0].openingBalance),
    closingBalance: round2(slices[slices.length - 1].closingBalance),
    purchased: round2(
      purchases
        .filter(
          (purchase) =>
            (from.getTime() === start.getTime()
              ? purchase.recordedAt >= from
              : purchase.recordedAt > from) &&
            (to.getTime() === end.getTime() ? purchase.recordedAt < to : purchase.recordedAt <= to),
        )
        .reduce((sum, purchase) => sum + purchase.units, 0),
    ),
    measuredUsed,
    creditUsed,
    difference: measuredUsed === null ? null : round2(measuredUsed - creditUsed),
    issues:
      intervalIssues ||
      (measuredUsed !== null && Math.abs(measuredUsed - creditUsed) > BALANCE_TOLERANCE ? 1 : 0),
  };
}
