import { z } from "zod";

const text = z.string().trim().max(1000).nullable();
const number = z.number().finite().nonnegative().nullable();

export const importRecordSchema = z.object({
  kind: z.enum(["reading", "purchase", "usage", "meter", "customer", "unresolved", "ignored"]),
  meterNumber: text,
  meterType: z.enum(["main", "bulk", "household"]).nullable(),
  date: text,
  dialReading: number,
  remainingBalance: number,
  cumulativeUsage: number,
  units: number,
  amountPaid: number,
  periodStart: text,
  periodEnd: text,
  customerName: text,
  zone: text,
  name: text,
  location: text,
  plotNo: text,
  phone: text,
  vendingSystem: z.enum(["amsol", "mpaya"]).nullable(),
  mainStage: z.enum(["borehole_to_tank", "tank_to_network"]).nullable(),
  volumeUnit: text,
  notes: text,
});

export type ImportRecord = z.infer<typeof importRecordSchema>;
export interface ExtractedImportRow {
  source: string;
  raw: Record<string, unknown>;
  data: ImportRecord;
  extractionIssues?: string[];
}

export function emptyImportRecord(): ImportRecord {
  return {
    kind: "unresolved",
    meterNumber: null,
    meterType: null,
    date: null,
    dialReading: null,
    remainingBalance: null,
    cumulativeUsage: null,
    units: null,
    amountPaid: null,
    periodStart: null,
    periodEnd: null,
    customerName: null,
    zone: null,
    name: null,
    location: null,
    plotNo: null,
    phone: null,
    vendingSystem: null,
    mainStage: null,
    volumeUnit: null,
    notes: null,
  };
}

export function importDate(value: string | null): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      text,
    )
  )
    return null;
  const normalized =
    text.length === 10
      ? `${text}T00:00:00+03:00`
      : /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
        ? text.replace(" ", "T")
        : `${text.replace(" ", "T")}+03:00`;
  const date = new Date(normalized);
  if (!Number.isFinite(+date)) return null;
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day
    ? date
    : null;
}

export function volumeFactor(unit: string | null): number | null {
  const key = unit?.trim().toLowerCase().replace(/\s/g, "") || "m3";
  if (["m3", "m³", "units", "unit", "cubicmetres", "cubicmeters"].includes(key)) return 1;
  if (["l", "litres", "liters", "litre", "liter"].includes(key)) return 0.001;
  return null;
}
