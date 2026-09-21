/**
 * A figure on a report. Numbers stay numbers so they can be charted, compared to
 * the period before, and reasoned about — and every one says where it came from.
 */
export const FIGURE_FORMATS = ["count", "money", "percent", "days", "hours", "text"] as const;
export type FigureFormat = (typeof FIGURE_FORMATS)[number];

export const FIGURE_SOURCES = ["aims", "typed", "ai"] as const;
export type FigureSource = (typeof FIGURE_SOURCES)[number];

export interface ReportFigure {
  /** Stable across periods, so the same figure can be compared month to month. */
  key: string;
  label: string;
  value: number | string | null;
  format: FigureFormat;
  unit?: string | null;
  source: FigureSource;
  /** What AIMS computed, kept when a person edits the value. */
  systemValue?: number | string | null;
  /** The same key in the period before this one. */
  previousValue?: number | string | null;
  /** Why the person changed it. */
  note?: string | null;
}

/** The old shape: a label and an already-formatted string. */
interface LegacyFigure {
  label: string;
  value: string;
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "figure";

const isLegacy = (f: unknown): f is LegacyFigure =>
  !!f &&
  typeof f === "object" &&
  typeof (f as LegacyFigure).label === "string" &&
  typeof (f as LegacyFigure).value === "string" &&
  !("format" in (f as object));

/**
 * Reads either shape. Reports written before typed figures still open, and are
 * upgraded the next time someone saves them.
 */
export function readFigures(raw: unknown): ReportFigure[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): ReportFigure[] => {
    if (isLegacy(f)) {
      return [
        {
          key: slug(f.label),
          label: f.label,
          value: f.value,
          format: "text",
          source: "typed",
        },
      ];
    }
    if (!f || typeof f !== "object") return [];
    const fig = f as Partial<ReportFigure>;
    if (typeof fig.label !== "string" || !fig.label) return [];
    return [
      {
        key: typeof fig.key === "string" && fig.key ? fig.key : slug(fig.label),
        label: fig.label,
        value: fig.value ?? null,
        format: FIGURE_FORMATS.includes(fig.format as FigureFormat)
          ? (fig.format as FigureFormat)
          : "text",
        unit: fig.unit ?? null,
        source: FIGURE_SOURCES.includes(fig.source as FigureSource)
          ? (fig.source as FigureSource)
          : "typed",
        systemValue: fig.systemValue ?? null,
        previousValue: fig.previousValue ?? null,
        note: fig.note ?? null,
      },
    ];
  });
}

/** Builds a figure AIMS worked out itself. */
export function aimsFigure(
  key: string,
  label: string,
  value: number | string | null,
  format: FigureFormat,
  unit?: string,
): ReportFigure {
  return { key, label, value, format, unit: unit ?? null, source: "aims", systemValue: value };
}

/**
 * Carries the previous period's value onto each figure, and keeps what AIMS
 * computed where a person has since changed it.
 */
export function withPrevious(figures: ReportFigure[], previous: ReportFigure[]): ReportFigure[] {
  const before = new Map(previous.map((f) => [f.key, f]));
  return figures.map((f) => ({ ...f, previousValue: before.get(f.key)?.value ?? null }));
}

/**
 * Merges what AIMS proposes into what is already on the report. A figure the
 * person typed or edited is never overwritten — its system value is refreshed so
 * the difference stays visible.
 */
export function mergeFigures(existing: ReportFigure[], suggested: ReportFigure[]): ReportFigure[] {
  const current = new Map(existing.map((f) => [f.key, f]));
  const merged = suggested.map((s) => {
    const mine = current.get(s.key);
    if (!mine) return s;
    const edited = mine.source !== "aims";
    return {
      ...s,
      value: edited ? mine.value : s.value,
      source: mine.source,
      systemValue: s.value,
      note: mine.note ?? null,
    };
  });
  const keys = new Set(merged.map((f) => f.key));
  return [...merged, ...existing.filter((f) => !keys.has(f.key))];
}

/** Reads a figure for a person: "KES 4,120,000", "31%", "128". */
export function formatFigure(f: ReportFigure): string {
  if (f.value === null || f.value === undefined || f.value === "") return "—";
  if (typeof f.value === "string") return f.value;
  const n = f.value;
  switch (f.format) {
    case "money":
      return `${f.unit ?? "KES"} ${Math.round(n).toLocaleString("en-KE")}`;
    case "percent":
      return `${Math.round(n * 10) / 10}%`;
    case "days":
      return `${Math.round(n)} day${Math.round(n) === 1 ? "" : "s"}`;
    case "hours":
      return `${Math.round(n)} hr${Math.round(n) === 1 ? "" : "s"}`;
    default:
      return Math.round(n).toLocaleString("en-KE");
  }
}

/** A share as a percentage, or null when there is nothing to divide by. */
export const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
