import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";

export const BACKEND_ROOT = path.resolve(__dirname, "..");
/** Seed files live here (git-ignored: real customer data). */
export const SEED_DIR = path.join(__dirname, "seed-data", "water");
const NAIROBI_OFFSET_MS = 3 * 3600_000;

export interface SeedRow {
  meterNumber: string;
  customerName: string | null;
  amount: number;
  units: number;
  unitsMissing: boolean;
  recordedAt: Date;
}

export interface ParsedFile {
  file: string;
  vendingSystem: "amsol" | "mpaya";
  rows: SeedRow[];
  skipped: number;
  fileTotal: number | null;
}

/** Excel date serials in the mPaya export are Nairobi wall-clock time. */
export function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400000) - NAIROBI_OFFSET_MS);
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else cur += ch;
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

const meterText = (value: unknown) =>
  typeof value === "number" ? String(Math.round(value)) : String(value ?? "").trim();

/** Amsol per-transaction CSV: Meter, Customer, Amount, Units, Created At (UTC). */
export function parseAmsolCsv(file: string): ParsedFile {
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const [header, ...data] = lines;
  const cols = splitCsvLine(header).map((h) => h.toLowerCase());
  const at = (name: string) => cols.indexOf(name);
  const idx = {
    meter: at("meter"),
    customer: at("customer"),
    amount: at("amount"),
    units: at("units"),
    date: at("created at"),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error(
      `${path.basename(file)} needs the columns Meter, Customer, Amount, Units, Created At`,
    );
  }
  const rows: SeedRow[] = [];
  let skipped = 0;
  for (const line of data) {
    const f = splitCsvLine(line);
    const amount = Number(f[idx.amount]);
    const units = Number(f[idx.units]);
    const recordedAt = new Date(f[idx.date]);
    if (
      !f[idx.meter] ||
      f[idx.amount] === "" ||
      f[idx.units] === "" ||
      !Number.isFinite(amount) ||
      !Number.isFinite(units) ||
      Number.isNaN(recordedAt.getTime())
    ) {
      skipped++;
      continue;
    }
    rows.push({
      meterNumber: f[idx.meter],
      customerName: f[idx.customer] || null,
      amount,
      units,
      unitsMissing: false,
      recordedAt,
    });
  }
  return { file, vendingSystem: "amsol", rows, skipped, fileTotal: null };
}

/** mPaya payments export: Date (Excel serial), Customer, Meter, Amount, Units, with a TOTAL row. */
export function parseMpayaPayments(file: string): ParsedFile {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const key = (row: Record<string, unknown>, ...names: string[]) => {
    const found = Object.keys(row).find((k) => names.includes(k.trim().toLowerCase()));
    return found ? row[found] : null;
  };
  const rows: SeedRow[] = [];
  let skipped = 0;
  let fileTotal: number | null = null;
  for (const row of raw) {
    const meter = meterText(key(row, "meter", "account no.", "account"));
    const amount = Number(key(row, "amount"));
    if (meter.toUpperCase() === "TOTAL") {
      fileTotal = Number.isFinite(amount) ? amount : null;
      continue;
    }
    const dateValue = key(row, "date", "created at", "paid at");
    const recordedAt =
      typeof dateValue === "number"
        ? excelSerialToDate(dateValue)
        : dateValue
          ? new Date(String(dateValue))
          : null;
    if (!meter || !Number.isFinite(amount) || !recordedAt || Number.isNaN(recordedAt.getTime())) {
      skipped++;
      continue;
    }
    const unitsValue = key(row, "units");
    const units = unitsValue === null || unitsValue === "" ? NaN : Number(unitsValue);
    const customer = key(row, "customer", "names", "name");
    rows.push({
      meterNumber: meter,
      customerName: customer ? String(customer).trim() : null,
      amount,
      units: Number.isFinite(units) ? units : 0,
      unitsMissing: !Number.isFinite(units),
      recordedAt,
    });
  }
  return { file, vendingSystem: "mpaya", rows, skipped, fileTotal };
}

/** mPaya account registry: Account no., Reg. date. Only registers meters; its payment totals are ignored. */
export function parseMpayaAccounts(file: string) {
  const wb = XLSX.readFile(file);
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: null,
  });
  const accounts = new Map<string, Date | null>();
  for (const row of raw) {
    const meter = meterText(row["Account no."]);
    if (!meter) continue;
    const reg = row["Reg. date"];
    const date =
      typeof reg === "number"
        ? excelSerialToDate(reg)
        : reg
          ? new Date(`${String(reg)}T00:00:00+03:00`)
          : null;
    accounts.set(meter, date && !Number.isNaN(date.getTime()) ? date : null);
  }
  return accounts;
}

/** The newest seed file whose name starts with the prefix, looking in the seed folder then backend/. */
export function newestFile(prefix: string, ext: string): string | null {
  const dirs = [SEED_DIR, BACKEND_ROOT].filter((d) => fs.existsSync(d));
  const matches = dirs
    .flatMap((dir) => fs.readdirSync(dir).map((f) => path.join(dir, f)))
    .filter((f) => {
      const name = path.basename(f).toLowerCase();
      return name.startsWith(prefix) && name.endsWith(ext);
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return matches[0] ?? null;
}

/** Where the database lives, without credentials, so nobody clears the wrong one. */
export function databaseLabel() {
  try {
    const env = fs.readFileSync(path.join(BACKEND_ROOT, ".env"), "utf8");
    const raw = process.env.DATABASE_URL ?? env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1];
    if (!raw) return "unknown database";
    const url = new URL(raw);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "unknown database";
  }
}
