import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

// Import of the real "meters csv.csv" export (Meter, Customer, Amount, Units, Created At)
// sitting at the AIMS project root, into the Water Project module's own tables. Rows with a
// blank Amount or Units are skipped — they're incomplete entries, not real transactions. Run via
// `npm run seed:water` from backend/. Safe to re-run: meters/customers are reused by exact match
// (meter number / customer name), and each usage record is deduped on
// (meterId, recordedAt, unitsSold, amountPaid) before insert — the CSV's "Created At" carries
// sub-millisecond precision, so this combination is effectively a natural transaction key. A
// re-run over the same CSV imports 0 new records; a CSV with only new rows appended imports just
// those.
const prisma = new PrismaClient();

const CSV_PATH = path.resolve(__dirname, "../../meters csv.csv");

// Minimal CSV line splitter that respects double-quoted fields (so a stray comma inside a
// quoted value doesn't split it) — this file doesn't need more than that.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Could not find CSV at ${CSV_PATH}`);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [headerLine, ...dataLines] = lines;
  const headers = splitCsvLine(headerLine).map((h) => h.toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  const idx = {
    meter: col("meter"),
    customer: col("customer"),
    amount: col("amount"),
    units: col("units"),
    createdAt: col("created at"),
  };

  let skipped = 0;
  let imported = 0;
  let duplicates = 0;
  const meterCache = new Map<string, string>(); // meterNumber -> WaterMeter.id
  const customerCache = new Map<string, string>(); // customer name -> WaterCustomer.id

  for (const line of dataLines) {
    const fields = splitCsvLine(line);
    const meterNumber = fields[idx.meter]?.trim();
    const customerName = fields[idx.customer]?.trim();
    const amountRaw = fields[idx.amount]?.trim();
    const unitsRaw = fields[idx.units]?.trim();
    const createdAtRaw = fields[idx.createdAt]?.trim();

    if (!meterNumber || !customerName || !amountRaw || !unitsRaw || !createdAtRaw) {
      skipped++;
      continue;
    }
    const amount = Number(amountRaw);
    const units = Number(unitsRaw);
    const recordedAt = new Date(createdAtRaw);
    if (!Number.isFinite(amount) || !Number.isFinite(units) || Number.isNaN(recordedAt.getTime())) {
      skipped++;
      continue;
    }

    let customerId = customerCache.get(customerName);
    if (!customerId) {
      const existing = await prisma.waterCustomer.findFirst({ where: { name: customerName } });
      const customer =
        existing ?? (await prisma.waterCustomer.create({ data: { name: customerName } }));
      customerId = customer.id;
      customerCache.set(customerName, customerId);
    }

    let meterId = meterCache.get(meterNumber);
    if (!meterId) {
      const existing = await prisma.waterMeter.findUnique({ where: { meterNumber } });
      const meter =
        existing ??
        (await prisma.waterMeter.create({
          data: { meterNumber, meterType: "household", customerId },
        }));
      meterId = meter.id;
      meterCache.set(meterNumber, meterId);
    }

    const duplicate = await prisma.waterUsageRecord.findFirst({
      where: { meterId, recordedAt, unitsSold: units, amountPaid: amount },
      select: { id: true },
    });
    if (duplicate) {
      duplicates++;
      continue;
    }

    await prisma.waterUsageRecord.create({
      data: {
        meterId,
        customerId,
        customerName,
        unitsSold: units,
        amountPaid: amount,
        recordedAt,
        source: "seed",
      },
    });
    imported++;
  }

  console.log(
    `Water seed complete: ${imported} usage records imported, ${duplicates} already existed (skipped), ${skipped} rows skipped (missing meter/customer/amount/units/date), ${meterCache.size} distinct meters, ${customerCache.size} distinct customers.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
