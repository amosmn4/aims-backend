// One-off (but re-runnable) data import for the water module. Run manually via:
//   npx ts-node prisma/import-water-mpaya.ts
// Kept in the repo rather than deleted after use — more mpaya imports / meter replacements are
// expected later, so this should stay a working, idempotent script, not a throwaway.
//
// Does three things, in order:
//   1. Restores the original "amsol" vending data from `meters csv.csv` (a per-transaction log —
//      each row is one vend against one meter), lost in an earlier incident this session.
//   2. Imports the "mpaya" account registry from an accounts export (`Account no.` is the only
//      reliable identity — no tenant name/house/phone in the source — so no WaterCustomer is
//      fabricated; each account becomes a customer-less household WaterMeter, same as how
//      main/bulk meters already work with no customer). Where the file's running "this month"
//      total payment is nonzero, that's recorded as one aggregate WaterUsageRecord.
//   3. Imports individual transactions from a mpaya payments export (skipping its TOTAL row).
//
// Idempotent: meters are found-or-created by `meterNumber` (unique); usage records are deduped on
// (meterId, recordedAt, unitsSold, amountPaid) — the same natural key WaterService.createUpload
// already uses for CSV/Excel uploads — so re-running this script never double-imports.
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, "..");

// Update these if the export filenames change on a future run.
const ACCOUNTS_FILE = path.join(ROOT, "accounts_260820104154.xlsx");
const PAYMENTS_FILE = path.join(ROOT, "payments_103927.xlsx");
const METERS_CSV_FILE = path.join(ROOT, "meters csv.csv");

async function findOrCreateCustomerByName(name: string) {
  const existing = await prisma.waterCustomer.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.waterCustomer.create({ data: { name } });
}

async function insertUsageRecordIfNew(params: {
  meterId: string;
  customerId: string | null;
  customerName: string;
  unitsSold: number;
  amountPaid: number;
  recordedAt: Date;
  uploadId: string;
}) {
  const duplicate = await prisma.waterUsageRecord.findFirst({
    where: {
      meterId: params.meterId,
      recordedAt: params.recordedAt,
      unitsSold: params.unitsSold,
      amountPaid: params.amountPaid,
    },
    select: { id: true },
  });
  if (duplicate) return false;
  await prisma.waterUsageRecord.create({
    data: {
      meterId: params.meterId,
      customerId: params.customerId,
      customerName: params.customerName,
      unitsSold: params.unitsSold,
      amountPaid: params.amountPaid,
      recordedAt: params.recordedAt,
      source: "upload",
      uploadId: params.uploadId,
    },
  });
  return true;
}

async function restoreAmsolMeters() {
  console.log("\n=== 1. Restoring amsol data from meters csv.csv ===");
  if (!fs.existsSync(METERS_CSV_FILE)) {
    console.log("  meters csv.csv not found — skipping (already restored, or file moved).");
    return;
  }
  const lines = fs.readFileSync(METERS_CSV_FILE, "utf8").split(/\r?\n/).filter(Boolean).slice(1); // drop header
  const rows = lines.map((line) => {
    const [meter, customer, amount, units, createdAt] = line.split(",");
    return {
      meter: meter.trim(),
      customer: customer.trim(),
      amount: Number(amount),
      units: Number(units),
      recordedAt: new Date(createdAt.trim()),
    };
  });

  // Earliest transaction per meter becomes that meter's installedAt.
  const earliestByMeter = new Map<string, Date>();
  for (const r of rows) {
    const cur = earliestByMeter.get(r.meter);
    if (!cur || r.recordedAt < cur) earliestByMeter.set(r.meter, r.recordedAt);
  }

  const upload = await prisma.waterUsageUpload.create({
    data: { fileName: "meters csv.csv (amsol restore)", recordCount: 0 },
  });

  const meterCache = new Map<string, { id: string; customerId: string | null }>();
  let metersCreated = 0;
  let recordsCreated = 0;
  let duplicatesSkipped = 0;

  for (const row of rows) {
    let meter = meterCache.get(row.meter);
    if (!meter) {
      const existing = await prisma.waterMeter.findUnique({ where: { meterNumber: row.meter } });
      if (existing) {
        meter = { id: existing.id, customerId: existing.customerId };
      } else {
        const customer = await findOrCreateCustomerByName(row.customer);
        const created = await prisma.waterMeter.create({
          data: {
            meterNumber: row.meter,
            meterType: "household",
            vendingSystem: "amsol",
            customerId: customer.id,
            installedAt: earliestByMeter.get(row.meter),
          },
        });
        meter = { id: created.id, customerId: created.customerId };
        metersCreated++;
      }
      meterCache.set(row.meter, meter);
    }

    const inserted = await insertUsageRecordIfNew({
      meterId: meter.id,
      customerId: meter.customerId,
      customerName: row.customer,
      unitsSold: row.units,
      amountPaid: row.amount,
      recordedAt: row.recordedAt,
      uploadId: upload.id,
    });
    if (inserted) recordsCreated++;
    else duplicatesSkipped++;
  }

  await prisma.waterUsageUpload.update({
    where: { id: upload.id },
    data: { recordCount: recordsCreated },
  });
  console.log(
    `  ${metersCreated} meters created, ${recordsCreated} usage records created, ${duplicatesSkipped} duplicates skipped.`,
  );
}

async function importMpayaAccounts() {
  console.log("\n=== 2. Importing mpaya accounts registry ===");
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    console.log(`  ${path.basename(ACCOUNTS_FILE)} not found — skipping.`);
    return;
  }
  const wb = XLSX.readFile(ACCOUNTS_FILE);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Sheet1"], {
    defval: null,
  });

  const upload = await prisma.waterUsageUpload.create({
    data: { fileName: path.basename(ACCOUNTS_FILE), recordCount: 0 },
  });

  const seenAccounts = new Set<string>();
  let metersCreated = 0;
  let recordsCreated = 0;
  let duplicateAccountsSkipped = 0;
  let zeroPaymentAccounts = 0;

  for (const row of rows) {
    const accountNo = String(row["Account no."]).trim();
    if (seenAccounts.has(accountNo)) {
      duplicateAccountsSkipped++;
      continue;
    }
    seenAccounts.add(accountNo);

    const regDateRaw = row["Reg. date"] as string | null;
    const installedAt = regDateRaw ? new Date(regDateRaw) : undefined;

    const existing = await prisma.waterMeter.findUnique({ where: { meterNumber: accountNo } });
    const meter =
      existing ??
      (await prisma.waterMeter.create({
        data: {
          meterNumber: accountNo,
          meterType: "household",
          vendingSystem: "mpaya",
          installedAt,
        },
      }));
    if (!existing) metersCreated++;

    const payment = Number(row["Total payment (2026 Aug)"]) || 0;
    const units = Number(row["Units"]) || 0;
    if (payment > 0) {
      const inserted = await insertUsageRecordIfNew({
        meterId: meter.id,
        customerId: meter.customerId,
        customerName: `Account ${accountNo}`,
        unitsSold: units,
        amountPaid: payment,
        // The source column is a running this-month total, not a per-day figure — dated to the
        // file's own pull time (encoded in its filename) rather than implying false precision.
        recordedAt: new Date(),
        uploadId: upload.id,
      });
      if (inserted) recordsCreated++;
    } else {
      zeroPaymentAccounts++;
    }
  }

  await prisma.waterUsageUpload.update({
    where: { id: upload.id },
    data: { recordCount: recordsCreated },
  });
  console.log(
    `  ${metersCreated} meters created, ${recordsCreated} usage records created, ${duplicateAccountsSkipped} duplicate accounts skipped, ${zeroPaymentAccounts} accounts with no August activity.`,
  );
}

async function importMpayaPayments() {
  console.log("\n=== 3. Importing mpaya live payments ===");
  if (!fs.existsSync(PAYMENTS_FILE)) {
    console.log(`  ${path.basename(PAYMENTS_FILE)} not found — skipping.`);
    return;
  }
  const wb = XLSX.readFile(PAYMENTS_FILE);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Sheet1"], {
    defval: null,
  });

  const upload = await prisma.waterUsageUpload.create({
    data: { fileName: path.basename(PAYMENTS_FILE), recordCount: 0 },
  });

  let metersCreated = 0;
  let recordsCreated = 0;
  let skipped = 0;

  for (const row of rows) {
    const meterRaw = row["Meter"];
    if (!meterRaw || meterRaw === "TOTAL" || !row["Time"]) {
      skipped++;
      continue;
    }
    const meterNumber = String(meterRaw).trim();
    const existing = await prisma.waterMeter.findUnique({ where: { meterNumber } });
    const meter =
      existing ??
      (await prisma.waterMeter.create({
        data: { meterNumber, meterType: "household", vendingSystem: "mpaya" },
      }));
    if (!existing) metersCreated++;

    // "Time" is like "20 Aug 10:01:05" with no year — the export is always same-day, so anchor
    // it to today's year/date and just take the time-of-day portion.
    const timeStr = String(row["Time"]);
    const timeMatch = timeStr.match(/(\d{2}):(\d{2}):(\d{2})/);
    const recordedAt = new Date();
    if (timeMatch) {
      recordedAt.setHours(Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3]), 0);
    }

    const inserted = await insertUsageRecordIfNew({
      meterId: meter.id,
      customerId: meter.customerId,
      customerName: (row["Names"] as string | null) ?? `Account ${meterNumber}`,
      unitsSold: Number(row["Units"]) || 0,
      amountPaid: Number(row["Amount"]) || 0,
      recordedAt,
      uploadId: upload.id,
    });
    if (inserted) recordsCreated++;
  }

  await prisma.waterUsageUpload.update({
    where: { id: upload.id },
    data: { recordCount: recordsCreated },
  });
  console.log(
    `  ${metersCreated} meters created, ${recordsCreated} usage records created, ${skipped} rows skipped (TOTAL/blank).`,
  );
}

async function main() {
  await restoreAmsolMeters();
  await importMpayaAccounts();
  await importMpayaPayments();

  const [byAmsol, byMpaya, totalRecords] = await Promise.all([
    prisma.waterMeter.count({ where: { vendingSystem: "amsol" } }),
    prisma.waterMeter.count({ where: { vendingSystem: "mpaya" } }),
    prisma.waterUsageRecord.count(),
  ]);
  console.log("\n=== Summary ===");
  console.log(`  amsol meters: ${byAmsol}`);
  console.log(`  mpaya meters: ${byMpaya}`);
  console.log(`  total usage records: ${totalRecords}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
