export interface UsageInterval {
  periodStart: Date;
  periodEnd: Date;
  units: unknown;
}

export function intervalFlow(intervals: UsageInterval[], start: Date, end: Date) {
  const rows = intervals
    .filter(
      (row) => row.periodStart >= start && row.periodEnd <= end && row.periodEnd > row.periodStart,
    )
    .sort((a, b) => +a.periodStart - +b.periodStart);
  if (!rows.length) return null;
  for (let index = 1; index < rows.length; index++)
    if (+rows[index].periodStart !== +rows[index - 1].periodEnd) return null;
  return {
    units: Math.round(rows.reduce((sum, row) => sum + Number(row.units), 0) * 100) / 100,
    from: rows[0].periodStart,
    to: rows[rows.length - 1].periodEnd,
  };
}
