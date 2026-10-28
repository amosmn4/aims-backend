export interface ReadingObservation {
  id: string;
  readingDate: Date;
  value: number | null;
  cumulativeUsage: number | null;
}

export interface ReadingWarning {
  code: string;
  severity: "warning" | "danger";
  message: string;
}

export interface ReadingAssessmentInput {
  meterType: "main" | "bulk" | "household";
  readingDate: Date;
  value: number | null;
  cumulativeUsage: number | null;
  observations: ReadingObservation[];
  purchasedUnits: number;
  now?: Date;
}

const DAY = 86_400_000;

export function assessReading(input: ReadingAssessmentInput): ReadingWarning[] {
  const warnings: ReadingWarning[] = [];
  const ordered = [...input.observations].sort((a, b) => +a.readingDate - +b.readingDate);
  const before = ordered.filter((r) => r.readingDate < input.readingDate);
  const after = ordered.filter((r) => r.readingDate > input.readingDate);
  const field = input.meterType === "household" ? "cumulativeUsage" : "value";
  const proposed = input[field];
  const counters = before.filter((r) => r[field] !== null);
  const previous = counters.at(-1);
  const next = after.find((r) => r[field] !== null);
  const label = input.meterType === "household" ? "Lifetime usage counter" : "Meter dial";
  if (proposed !== null && previous && proposed < previous[field]!) {
    warnings.push({
      code: "counter_decreased",
      severity: "danger",
      message: `${label} falls from ${previous[field]} on ${previous.readingDate.toISOString()} to ${proposed}. Check for a typo, rollover, reset, or replacement before confirming.`,
    });
  }
  if (proposed !== null && next && proposed > next[field]!) {
    warnings.push({
      code: "above_later_reading",
      severity: "danger",
      message: `${label} ${proposed} exceeds the later recorded value ${next[field]} on ${next.readingDate.toISOString()}. Check this historical reading.`,
    });
  }
  if (proposed !== null && previous && proposed >= previous[field]!) {
    const days = (+input.readingDate - +previous.readingDate) / DAY;
    const rates = counters
      .slice(-13)
      .flatMap((r, index, history) => {
        const prior = history[index - 1];
        const elapsed = prior ? (+r.readingDate - +prior.readingDate) / DAY : 0;
        const delta = prior ? r[field]! - prior[field]! : 0;
        return elapsed >= 0.25 && delta > 0 ? [delta / elapsed] : [];
      })
      .sort((a, b) => a - b);
    const typical = rates.length >= 3 ? rates[Math.floor(rates.length / 2)] : null;
    const rate = days > 0 ? (proposed - previous[field]!) / days : 0;
    if (typical !== null && rate > typical * 3 && proposed - previous[field]! > 1) {
      warnings.push({
        code: "unusually_high_usage",
        severity: "danger",
        message: `This implies ${rate.toFixed(2)} m³ per day; this meter's recent median is ${typical.toFixed(2)} m³ per day. Check the reading and decimal point.`,
      });
    }
    if (days >= 20 && proposed === previous[field]) {
      warnings.push({
        code: "unchanged_counter",
        severity: "warning",
        message: `The usage counter has not moved for ${Math.floor(days)} days. Confirm the meter was checked and is still in use.`,
      });
    }
  }
  if (input.meterType === "household" && input.value !== null) {
    const prior = before.filter((r) => r.value !== null).at(-1);
    if (prior) {
      const creditUsed = prior.value! + input.purchasedUnits - input.value;
      if (creditUsed < -0.1)
        warnings.push({
          code: "unexplained_credit_increase",
          severity: "danger",
          message: `Remaining credit ${input.value} exceeds the previous ${prior.value} plus ${input.purchasedUnits} purchased units. Check missing top-ups or a misread balance.`,
        });
      if (input.cumulativeUsage !== null && prior.cumulativeUsage !== null) {
        const measured = input.cumulativeUsage - prior.cumulativeUsage;
        if (measured >= 0 && Math.abs(measured - creditUsed) > 0.1)
          warnings.push({
            code: "credit_usage_mismatch",
            severity: "danger",
            message: `The lifetime counter indicates ${measured.toFixed(2)} m³ used, while balances and purchases indicate ${creditUsed.toFixed(2)} m³. Check both figures and missing top-ups.`,
          });
      }
    }
  }
  if (+input.readingDate > +(input.now ?? new Date()) + 300_000)
    warnings.push({
      code: "future_reading",
      severity: "warning",
      message: "This reading is dated in the future. Check the date and time.",
    });
  return warnings;
}
