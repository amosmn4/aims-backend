// Loads the water vending data: the Amsol meters CSV and the mPaya payments export.
//   npm run water:seed                      import (safe to re-run; duplicates are skipped)
//   npm run water:seed -- --dry-run         show what would be imported, change nothing
//   npm run water:seed -- --accounts        also register every mPaya account, even with no payments
//   npm run water:seed -- --payments <file> --meters <file> --accounts <file>   use other files
// Files are read from backend/prisma/seed-data/water/ (git-ignored). Clear the previous seed first
// with `npm run water:clear-seed -- --yes`.
import { PrismaClient, type WaterVendingSystem } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import {
  BACKEND_ROOT,
  SEED_DIR,
  databaseLabel,
  newestFile,
  parseAmsolCsv,
  parseMpayaAccounts,
  parseMpayaPayments,
  type ParsedFile,
} from "./water-seed-files";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? path.resolve(args[i + 1]) : null;
};

const DRY_RUN = flag("--dry-run");
const METERS_FILE =
  option("--meters") ??
  [path.join(SEED_DIR, "meters csv.csv"), path.join(BACKEND_ROOT, "meters csv.csv")].find((f) =>
    fs.existsSync(f),
  ) ??
  path.join(SEED_DIR, "meters csv.csv");
const PAYMENTS_FILE = option("--payments") ?? newestFile("payments", ".xlsx");
const ACCOUNTS_FILE = flag("--accounts")
  ? (option("--accounts") ?? newestFile("accounts", ".xlsx"))
  : null;

const recordKey = (meterId: string, at: Date, units: number, amount: number) =>
  `${meterId}|${at.getTime()}|${units.toFixed(2)}|${amount.toFixed(2)}`;
const money = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

/** The name used most often on a meter; ties go to the latest payment. */
function ownerName(rows: ParsedFile["rows"]) {
  const tally = new Map<string, { count: number; last: number }>();
  for (const r of rows) {
    if (!r.customerName) continue;
    const t = tally.get(r.customerName) ?? { count: 0, last: 0 };
    t.count++;
    t.last = Math.max(t.last, r.recordedAt.getTime());
    tally.set(r.customerName, t);
  }
  return (
    [...tally.entries()].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)[0]?.[0] ??
    null
  );
}

async function importFile(parsed: ParsedFile, registry: Map<string, Date | null>) {
  const label = path.basename(parsed.file);
  const byMeter = new Map<string, ParsedFile["rows"]>();
  for (const r of parsed.rows)
    byMeter.set(r.meterNumber, [...(byMeter.get(r.meterNumber) ?? []), r]);

  const existingMeters = await prisma.waterMeter.findMany({
    where: { meterNumber: { in: [...byMeter.keys()] } },
    select: { id: true, meterNumber: true, customerId: true },
  });
  const meterByNumber = new Map(existingMeters.map((m) => [m.meterNumber, m]));
  const newMeters = [...byMeter.keys()].filter((n) => !meterByNumber.has(n));

  const existingRecords = existingMeters.length
    ? await prisma.waterUsageRecord.findMany({
        where: { meterId: { in: existingMeters.map((m) => m.id) } },
        select: { meterId: true, recordedAt: true, unitsSold: true, amountPaid: true },
      })
    : [];
  const seen = new Set(
    existingRecords.map((r) =>
      recordKey(r.meterId, r.recordedAt, Number(r.unitsSold), Number(r.amountPaid)),
    ),
  );

  let duplicates = 0;
  const toInsert: { meterNumber: string; row: ParsedFile["rows"][number] }[] = [];
  for (const [meterNumber, rows] of byMeter) {
    const meter = meterByNumber.get(meterNumber);
    for (const row of rows) {
      const key = meter ? recordKey(meter.id, row.recordedAt, row.units, row.amount) : null;
      if (key && seen.has(key)) {
        duplicates++;
        continue;
      }
      if (key) seen.add(key);
      toInsert.push({ meterNumber, row });
    }
  }
  const amount = toInsert.reduce((sum, r) => sum + r.row.amount, 0);
  const noUnits = toInsert.filter((r) => r.row.unitsMissing).length;

  console.log(`\n${label} (${parsed.vendingSystem === "amsol" ? "Amsol" : "mPaya"})`);
  console.log(
    `  ${parsed.rows.length} payments read, ${parsed.skipped} rows skipped (blank or incomplete)`,
  );
  if (parsed.fileTotal !== null) {
    const fileSum = parsed.rows.reduce((s, r) => s + r.amount, 0);
    console.log(
      `  File TOTAL ${money(parsed.fileTotal)}; rows add up to ${money(fileSum)}${Math.abs(fileSum - parsed.fileTotal) < 0.01 ? " (matches)" : " (DOES NOT MATCH)"}`,
    );
  }
  console.log(
    `  ${newMeters.length} new meters, ${toInsert.length} new payments (${money(amount)}), ${duplicates} already in the database`,
  );
  if (noUnits)
    console.log(`  ${noUnits} payments have no units in the file and are saved with 0 units`);
  if (DRY_RUN || (newMeters.length === 0 && toInsert.length === 0)) {
    return { meters: DRY_RUN ? newMeters.length : 0, records: DRY_RUN ? toInsert.length : 0 };
  }

  const upload = await prisma.waterUsageUpload.create({
    data: { fileName: `${label} (seed)`, recordCount: 0 },
  });
  for (const meterNumber of newMeters) {
    const rows = byMeter.get(meterNumber)!;
    const firstPayment = new Date(Math.min(...rows.map((r) => r.recordedAt.getTime())));
    let customerId: string | null = null;
    if (parsed.vendingSystem === "amsol") {
      const name = ownerName(rows);
      if (name) {
        const customer =
          (await prisma.waterCustomer.findFirst({ where: { name } })) ??
          (await prisma.waterCustomer.create({ data: { name } }));
        customerId = customer.id;
      }
    }
    const created = await prisma.waterMeter.create({
      data: {
        meterNumber,
        meterType: "household",
        vendingSystem: parsed.vendingSystem as WaterVendingSystem,
        customerId,
        installedAt: registry.get(meterNumber) ?? firstPayment,
      },
      select: { id: true, meterNumber: true, customerId: true },
    });
    meterByNumber.set(meterNumber, created);
  }

  const data = toInsert.map(({ meterNumber, row }) => {
    const meter = meterByNumber.get(meterNumber)!;
    return {
      meterId: meter.id,
      customerId: meter.customerId,
      customerName: row.customerName ?? `Account ${meterNumber}`,
      unitsSold: row.units,
      amountPaid: row.amount,
      recordedAt: row.recordedAt,
      source: "seed" as const,
      uploadId: upload.id,
    };
  });
  for (let i = 0; i < data.length; i += 500) {
    await prisma.waterUsageRecord.createMany({ data: data.slice(i, i + 500) });
  }
  await prisma.waterUsageUpload.update({
    where: { id: upload.id },
    data: { recordCount: data.length },
  });
  return { meters: newMeters.length, records: data.length };
}

async function registerAccounts(registry: Map<string, Date | null>) {
  const existing = new Set(
    (
      await prisma.waterMeter.findMany({
        where: { meterNumber: { in: [...registry.keys()] } },
        select: { meterNumber: true },
      })
    ).map((m) => m.meterNumber),
  );
  const missing = [...registry.entries()].filter(([n]) => !existing.has(n));
  console.log(`\n${path.basename(ACCOUNTS_FILE!)} (mPaya accounts)`);
  console.log(
    `  ${registry.size} accounts, ${missing.length} not registered yet (no payments in the payments file)`,
  );
  if (DRY_RUN || missing.length === 0) return missing.length;
  await prisma.waterMeter.createMany({
    data: missing.map(([meterNumber, installedAt]) => ({
      meterNumber,
      meterType: "household" as const,
      vendingSystem: "mpaya" as const,
      installedAt,
    })),
    skipDuplicates: true,
  });
  return missing.length;
}

async function main() {
  console.log(`${DRY_RUN ? "Dry run — nothing will be saved. " : ""}Database: ${databaseLabel()}`);
  const files: ParsedFile[] = [];
  if (fs.existsSync(METERS_FILE)) files.push(parseAmsolCsv(METERS_FILE));
  else console.log(`\nAmsol CSV not found at ${METERS_FILE} — skipped.`);
  if (PAYMENTS_FILE && fs.existsSync(PAYMENTS_FILE)) files.push(parseMpayaPayments(PAYMENTS_FILE));
  else
    console.log(
      "\nNo mPaya payments file (payments*.xlsx) found in prisma/seed-data/water/ — skipped.",
    );
  if (files.length === 0)
    throw new Error(
      "Nothing to import. Put the files in backend/prisma/seed-data/water/ or pass --meters / --payments.",
    );

  const registry =
    ACCOUNTS_FILE && fs.existsSync(ACCOUNTS_FILE)
      ? parseMpayaAccounts(ACCOUNTS_FILE)
      : new Map<string, Date | null>();
  let meters = 0;
  let records = 0;
  for (const parsed of files) {
    const result = await importFile(parsed, registry);
    meters += result.meters;
    records += result.records;
  }
  if (ACCOUNTS_FILE) meters += await registerAccounts(registry);

  console.log(`\n${DRY_RUN ? "Would add" : "Added"} ${meters} meters and ${records} payments.`);
  if (!DRY_RUN) {
    const [meterCount, recordCount] = await Promise.all([
      prisma.waterMeter.count(),
      prisma.waterUsageRecord.count(),
    ]);
    console.log(`The database now has ${meterCount} meters and ${recordCount} payments.`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
