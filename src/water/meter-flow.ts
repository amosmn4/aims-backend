// How far a dial moved inside a period, from the readings around it.
// Readings rarely fall on the first and last day, so the dial is placed at the
// period's edges by spreading each straddling gap evenly over its days. Months
// then add up to the dial's total movement: nothing is lost or counted twice.

export interface DialReading {
  at: Date;
  value: number;
}

export interface DialFlow {
  units: number;
  /** The dates the figure covers: the period's edge, or the nearest reading inside it. */
  from: Date;
  to: Date;
}

function valueAt(a: DialReading, b: DialReading, at: Date): number {
  const span = b.at.getTime() - a.at.getTime();
  if (span <= 0) return b.value;
  return a.value + ((b.value - a.value) * (at.getTime() - a.at.getTime())) / span;
}

/**
 * `before` is the last reading ahead of the period, `first` and `last` the
 * outermost readings inside it, `after` the first reading once it has ended.
 * Null when the readings do not bound any part of the period.
 */
export function dialFlow(
  around: {
    before: DialReading | null;
    first: DialReading | null;
    last: DialReading | null;
    after: DialReading | null;
  },
  start: Date,
  end: Date,
): DialFlow | null {
  const { before, first, last, after } = around;
  const nextInside = first ?? after;
  const opening: DialReading | null =
    before && nextInside ? { at: start, value: valueAt(before, nextInside, start) } : first;
  const lastKnown = last ?? before;
  const closing: DialReading | null =
    after && lastKnown ? { at: end, value: valueAt(lastKnown, after, end) } : last;
  if (!opening || !closing || closing.at <= opening.at) return null;
  return {
    units: Math.max(0, closing.value - opening.value),
    from: opening.at,
    to: closing.at,
  };
}
