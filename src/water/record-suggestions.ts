import type { ReadingAssessmentInput } from "./reading-assessment";

export interface RecordSuggestion {
  label: string;
  explanation: string;
  confidence: "high" | "possible";
  patch: Record<string, string | number | null>;
  recordId?: string;
}

export function normaliseMatch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchSimilarity(left: string | null | undefined, right: string | null | undefined) {
  const a = normaliseMatch(left),
    b = normaliseMatch(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grid = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        grid[i][j] = Math.min(grid[i][j], grid[i - 2][j - 2] + 1);
    }
  return 1 - grid[a.length][b.length] / Math.max(a.length, b.length);
}

export function suggestReadingValues(input: ReadingAssessmentInput): RecordSuggestion[] {
  const field = input.meterType === "household" ? "cumulativeUsage" : "value";
  const value = input[field];
  const history = input.observations
    .filter((row) => row[field] !== null)
    .sort((a, b) => +a.readingDate - +b.readingDate);
  const previous = history.filter((row) => row.readingDate < input.readingDate).at(-1);
  const next = history.find((row) => row.readingDate > input.readingDate);
  if (value === null || !previous) return [];
  const candidates = new Set<number>();
  const source = String(value);
  for (let i = 0; i < source.length; i++) {
    if (source[i] === ".") continue;
    for (const digit of "0123456789")
      candidates.add(Number(source.slice(0, i) + digit + source.slice(i + 1)));
    if (i < source.length - 1 && source[i + 1] !== ".")
      candidates.add(Number(source.slice(0, i) + source[i + 1] + source[i] + source.slice(i + 2)));
  }
  for (const factor of [0.01, 0.1, 10, 100]) candidates.add(value * factor);
  const prior = history.filter((row) => row.readingDate < input.readingDate).slice(-13);
  const rates = prior
    .flatMap((row, index) => {
      const before = prior[index - 1];
      const days = before ? (+row.readingDate - +before.readingDate) / 86400000 : 0;
      const delta = before ? row[field]! - before[field]! : 0;
      return days >= 0.25 && delta > 0 ? [delta / days] : [];
    })
    .sort((a, b) => a - b);
  const typical = rates.length >= 3 ? rates[Math.floor(rates.length / 2)] : 0;
  const expected =
    previous[field]! + (typical * (+input.readingDate - +previous.readingDate)) / 86400000;
  const elapsedDays = (+input.readingDate - +previous.readingDate) / 86400000;
  const highUsage =
    typical > 0 &&
    elapsedDays > 0 &&
    (value - previous[field]!) / elapsedDays > typical * 3 &&
    value - previous[field]! > 1;
  if (value >= previous[field]! && (!next || value <= next[field]!) && !highUsage) return [];
  const patchField = input.meterType === "household" ? "cumulativeUsage" : "dialReading";
  return [...candidates]
    .filter(
      (candidate) =>
        candidate !== value &&
        Number.isFinite(candidate) &&
        candidate >= previous[field]! &&
        (!next || candidate <= next[field]!) &&
        Math.abs(candidate * 100 - Math.round(candidate * 100)) < 0.00001,
    )
    .sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))
    .slice(0, 3)
    .map((candidate) => ({
      label: `Possible reading: ${candidate.toLocaleString("en-KE")} m³`,
      explanation: `A digit change, transposition, or decimal correction fits the recorded counter direction${typical ? ` and recent typical usage of ${typical.toFixed(2)} m³/day` : ""}. This is a suggestion; verify it against the source or meter before accepting.`,
      confidence: "possible",
      patch: { [patchField]: candidate },
    }));
}
