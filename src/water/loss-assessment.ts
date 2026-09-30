// Judging the gap between what a meter passed and what households took.
// Water is paid for first and drawn later, so purchases are not use. A gap is only
// called a loss when typical use and credit left from before cannot explain it.

export type WaterVerdict =
  "not_measured" | "bought_ahead" | "over_read" | "within_limit" | "possible_loss" | "likely_loss";

/** Allows for water sitting in the short pipe runs and for dials that round. */
export const LOSS_LIMIT_PCT = 8;
/** Meter displays round, so a gap this small is not a finding either way. */
export const GAP_TOLERANCE = 0.5;
/** How far back purchases are averaged to predict typical use. */
export const HISTORY_DAYS = 90;
/** Purchases this recent may still be sitting on the meters as unused credit. */
export const CARRY_DAYS = 30;
const MIN_HISTORY_DAYS = 14;
/** A meter is said to have risen when its daily volume grew by this much. */
const RISE_FACTOR = 1.3;
const RISE_MIN_UNITS = 10;
const DAY_MS = 86_400_000;

export interface Purchase {
  recordedAt: Date;
  units: number;
}

/** What households took, and what they could plausibly have taken. */
export interface HouseholdSide {
  /** Used when balances were read, else paid for. */
  taken: number;
  basis: "readings" | "tokens";
  /** Typical use over the same number of days, from earlier purchases. Null without history. */
  expected: number | null;
  /** Bought shortly before the window beyond typical use, so possibly still unused. */
  carried: number;
}

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

/** Predicts use in [from, to) from purchases before it, and the credit likely carried in. */
export function estimateFromHistory(
  purchases: Purchase[],
  from: Date,
  to: Date,
): { expected: number | null; carried: number } {
  const earliestAllowed = from.getTime() - HISTORY_DAYS * DAY_MS;
  const history = purchases.filter(
    (p) => p.recordedAt.getTime() >= earliestAllowed && p.recordedAt < from,
  );
  if (history.length === 0) return { expected: null, carried: 0 };
  const first = Math.min(...history.map((p) => p.recordedAt.getTime()));
  const span = Math.min(HISTORY_DAYS, (from.getTime() - first) / DAY_MS);
  if (span < MIN_HISTORY_DAYS) return { expected: null, carried: 0 };

  const perDay = history.reduce((sum, p) => sum + p.units, 0) / span;
  const carryDays = Math.min(CARRY_DAYS, span);
  const recentFrom = from.getTime() - carryDays * DAY_MS;
  const recent = history
    .filter((p) => p.recordedAt.getTime() >= recentFrom)
    .reduce((sum, p) => sum + p.units, 0);
  return {
    expected: perDay * Math.max(0, daysBetween(from, to)),
    carried: Math.max(0, recent - perDay * carryDays),
  };
}

/** The most households could plausibly have drawn: measured use, or the generous estimate. */
export function explainedUnits(h: HouseholdSide): number {
  if (h.basis === "readings") return h.taken;
  return Math.max(h.taken, h.expected ?? 0) + h.carried;
}

export interface GapAssessment {
  /** Passed less what households took and known volumes. Negative means bought ahead. */
  gap: number;
  gapPct: number | null;
  /** What is left after typical use and carried credit are allowed for. */
  unexplained: number;
  unexplainedPct: number | null;
  verdict: WaterVerdict;
}

export function assessGap(input: {
  measured: boolean;
  passed: number;
  /** Volumes someone wrote down: line fills, flushing, burst repairs. */
  adjustments: number;
  household: HouseholdSide;
}): GapAssessment {
  const { measured, passed, adjustments, household } = input;
  const pct = (n: number) => (measured && passed > 0 ? (n / passed) * 100 : null);
  const gap = passed - household.taken - adjustments;
  const unexplained = passed - explainedUnits(household) - adjustments;
  const gapPct = pct(gap);
  const unexplainedPct = pct(unexplained);

  let verdict: WaterVerdict;
  if (!measured) verdict = "not_measured";
  else if (gap < -GAP_TOLERANCE) {
    verdict = household.basis === "tokens" ? "bought_ahead" : "over_read";
  } else if (gapPct === null || gapPct <= LOSS_LIMIT_PCT) verdict = "within_limit";
  else if (unexplainedPct !== null && unexplainedPct > LOSS_LIMIT_PCT) verdict = "likely_loss";
  else verdict = "possible_loss";
  return { gap, gapPct, unexplained, unexplainedPct, verdict };
}

/** True when a meter's daily volume clearly grew against the period before. */
export function roseSharply(now: { units: number; days: number }, before: typeof now): boolean {
  if (now.days <= 0 || before.days <= 0 || before.units <= 0) return false;
  const scaledBefore = (before.units / before.days) * now.days;
  return now.units >= RISE_FACTOR * scaledBefore && now.units - scaledBefore >= RISE_MIN_UNITS;
}

export const wholeUnits = (n: number) => Math.round(n).toLocaleString("en-US");
const shortDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
const dateSpan = (from: Date | null, to: Date | null) =>
  from && to ? `Between ${shortDate(from)} and ${shortDate(to)}` : "In this period";
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** The gap in words, so a figure never stands without its reason. */
export function gapNote(r: {
  /** For example "the main meter" or "Zone 3's bulk meter". */
  what: string;
  from: Date | null;
  to: Date | null;
  passed: number;
  household: HouseholdSide;
  assessment: GapAssessment;
  /** Zone lines skip the advice the network line already gives. */
  brief?: boolean;
}): string {
  const { household: h, assessment: a } = r;
  const took = h.basis === "tokens" ? "paid for" : "used";
  const opening = `${dateSpan(r.from, r.to)} ${r.what} passed ${wholeUnits(r.passed)} m³ and households ${took} ${wholeUnits(h.taken)} m³`;
  const gap = `${wholeUnits(a.gap)} m³${a.gapPct === null ? "" : ` (${a.gapPct.toFixed(1)}%)`}`;
  const cushion = [
    h.expected !== null &&
      h.expected > h.taken &&
      `typically use about ${wholeUnits(h.expected)} m³ over these days`,
    h.carried > GAP_TOLERANCE &&
      `had about ${wholeUnits(h.carried)} m³ bought earlier that may still be unused`,
  ].filter((part): part is string => !!part);

  switch (a.verdict) {
    case "not_measured":
      return `${capital(r.what)} needs two readings before its water can be compared with what households took.`;
    case "bought_ahead":
      return `${opening}. Households buy water before they use it, so the extra ${wholeUnits(-a.gap)} m³ is credit still on their meters, not a loss.${r.brief ? "" : " Reading household balances will show what was actually used."}`;
    case "over_read":
      return `${opening}, ${wholeUnits(-a.gap)} m³ more than the meter passed. Water cannot be used before it is released, so check the readings on both sides.`;
    case "possible_loss":
      return `${opening}, a gap of ${gap}. Households here ${cushion.join(" and ")}, which could cover it, so it is not yet counted as a loss.${r.brief ? "" : " Reading household balances will settle it."}`;
    case "likely_loss": {
      if (h.basis === "readings") {
        return `${opening}, so ${gap} is lost, above the ${LOSS_LIMIT_PCT}% limit.${r.brief ? "" : " Check for leaks, unregistered connections and stopped meters."}`;
      }
      const allowed = [
        h.expected !== null && `typical use of about ${wholeUnits(h.expected)} m³`,
        `about ${wholeUnits(h.carried)} m³ of credit left from earlier purchases`,
      ].filter((part): part is string => !!part);
      return `${opening}, a gap of ${gap}. Even allowing for ${allowed.join(" and ")}, ${wholeUnits(a.unexplained)} m³ (${a.unexplainedPct!.toFixed(1)}%) is not explained, so this is likely a loss.${r.brief ? "" : " Check for leaks, unregistered connections and stopped meters."}`;
    }
    default:
      return `${opening}, leaving ${gap} unaccounted for, within the ${LOSS_LIMIT_PCT}% allowed for water in the pipes and meter rounding.`;
  }
}

/** A sharp rise on a meter, set against whether purchases rose with it. */
export function riseNote(r: {
  what: string;
  now: { units: number; days: number };
  before: { units: number; days: number };
  taken: number;
  takenBefore: number;
  basis: "readings" | "tokens";
  verdict: WaterVerdict;
}): string | null {
  if (!roseSharply(r.now, r.before)) return null;
  // Periods of unequal length are compared per day so the rise is real.
  const sameLength = Math.abs(r.now.days - r.before.days) <= 0.2 * r.before.days;
  const perDay = (v: { units: number; days: number }) =>
    `${(v.units / v.days).toFixed(1)} m³ a day`;
  const rise = sameLength
    ? `from ${wholeUnits(r.before.units)} m³ to ${wholeUnits(r.now.units)} m³`
    : `from ${perDay(r.before)} to ${perDay(r.now)}`;
  const took = r.basis === "tokens" ? "paid for" : "used";
  const households = `its households ${took} ${wholeUnits(r.taken)} m³ against ${wholeUnits(r.takenBefore)} m³ before`;
  const closing =
    r.verdict === "likely_loss"
      ? "The purchases, even with credit left from before, do not explain the rise. Look here first for a leak or an unmetered connection."
      : r.verdict === "possible_loss"
        ? "Purchases did not rise as much, though unused credit from before could cover the difference."
        : "Household purchases account for the rise.";
  return `${capital(r.what)} rose ${rise}, while ${households}. ${closing}`;
}
