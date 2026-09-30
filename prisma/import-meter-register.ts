// Loads the meter register: matches each meter to its customer, plot and zone, and
// takes the meters marked "Not in use" out of use. Payments and readings are never touched.
//   npm run water:import-register -- --dry-run     show what would change, change nothing
//   npm run water:import-register                  apply (safe to re-run)
//   npm run water:import-register -- --file <file> use another register
//   npm run water:import-register -- --inside 5=1  also put Zone 5 inside Zone 1
// Zone 3 sits inside Zone 2: its meters count under Zone 2 as well, next to Zone 2's own.
// The register (Meter_Register*.xlsx) is read from backend/ or backend/prisma/seed-data/water/.
import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { databaseLabel, newestFile } from "./water-seed-files";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fileArg = args.indexOf("--file");
const FILE =
  fileArg >= 0 && args[fileArg + 1]
    ? path.resolve(args[fileArg + 1])
    : newestFile("meter_register", ".xlsx");

// Purchases this close to the newest one mean a "not in use" meter is still buying water.
const RECENT_DAYS = 60;
const DAY_MS = 86_400_000;

interface RegisterRow {
  sn: string;
  meterNumber: string;
  customer: string | null;
  plotNo: string | null;
  zone: string | null;
  inUse: boolean;
  notes: string | null;
}

const text = (value: unknown) =>
  typeof value === "number" ? String(Math.round(value)) : String(value ?? "").trim();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const firstWord = (s: string) => s.trim().split(/\s+/)[0].toLowerCase();
const zoneKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^zone\s*/, "");

// Inner zone -> the zone it sits inside. Add more with --inside <zone>=<zone it is inside>.
const SUB_ZONES = new Map<string, string>([["3", "2"]]);
const stop = (message: string): never => {
  console.error(message);
  process.exit(1);
};
args.forEach((arg, i) => {
  if (arg !== "--inside") return;
  const [inner, outer] = (args[i + 1] ?? "").split("=").map(zoneKey);
  if (!inner || !outer || inner === outer) {
    stop('--inside needs two different zones, for example: --inside "3=2"');
  }
  SUB_ZONES.set(inner, outer);
});
for (const start of SUB_ZONES.keys()) {
  const seen = new Set([start]);
  for (let at = SUB_ZONES.get(start); at; at = SUB_ZONES.get(at)) {
    if (seen.has(at)) stop(`Zones can't sit inside each other in a loop (zone ${at}).`);
    seen.add(at);
  }
}

function readRegister(file: string) {
  const wb = XLSX.readFile(file);
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
  });
  const headerAt = grid.findIndex((r) => r.some((c) => /^meter\s*(number|no)/i.test(text(c))));
  if (headerAt < 0) throw new Error(`${path.basename(file)} has no "Meter Number" column.`);
  const header = grid[headerAt].map((c) => text(c).toLowerCase());
  const col = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
  const idx = {
    sn: col(/^s\/?n/),
    meter: col(/^meter\s*(number|no)/),
    customer: col(/^customer/, /^name/),
    plot: col(/^plot/),
    zone: col(/^zone/),
    status: col(/^status/),
    notes: col(/^notes?/),
  };
  if (idx.status < 0) throw new Error(`${path.basename(file)} has no "Status" column.`);

  const rows: RegisterRow[] = [];
  const unreadable: string[] = [];
  for (const r of grid.slice(headerAt + 1)) {
    const meterNumber = text(r[idx.meter]);
    // Legend and totals rows sit under the list; only meter numbers are digits.
    if (!/^\d{6,}$/.test(meterNumber)) continue;
    const status = text(r[idx.status]).toLowerCase();
    if (!/in use/.test(status)) {
      unreadable.push(`${meterNumber} (status "${text(r[idx.status])}")`);
      continue;
    }
    const cell = (i: number) => (i >= 0 ? text(r[i]) || null : null);
    rows.push({
      sn: cell(idx.sn) ?? "",
      meterNumber,
      customer: cell(idx.customer),
      plotNo: cell(idx.plot),
      zone: cell(idx.zone),
      inUse: !/not in use/.test(status),
      notes: cell(idx.notes),
    });
  }
  return { rows, unreadable };
}

function editDistance(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

type Tx = Prisma.TransactionClient;

async function run(tx: Tx, rows: RegisterRow[]) {
  const report = {
    matched: 0,
    typoMatches: [] as string[],
    typoMatchedNumbers: new Set<string>(),
    newMeters: [] as string[],
    newZones: [] as string[],
    nestedZones: [] as string[],
    zoneConflicts: [] as string[],
    customersCreated: 0,
    customersUpdated: 0,
    placed: 0,
    retired: [] as string[],
    stillBuying: [] as string[],
    unclearZones: [] as string[],
    skipped: [] as string[],
    inactiveButInUse: [] as string[],
    followUp: [] as string[],
    paymentsLinked: 0,
    notInRegister: [] as string[],
  };

  const meters = await tx.waterMeter.findMany({
    include: {
      customer: { include: { _count: { select: { meters: true } } } },
      usageRecords: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { recordedAt: true, customerName: true },
      },
    },
  });
  type DbMeter = (typeof meters)[number];
  const byNumber = new Map(meters.map((m) => [m.meterNumber, m]));
  const registerNumbers = new Set(rows.map((r) => r.meterNumber));
  const newest = await tx.waterUsageRecord.aggregate({ _max: { recordedAt: true } });
  const recentFrom = newest._max.recordedAt
    ? new Date(newest._max.recordedAt.getTime() - RECENT_DAYS * DAY_MS)
    : null;

  // A register number one slip away from a vending account with the same payer is that account.
  const typoMatch = (row: RegisterRow): DbMeter | null => {
    if (!row.customer) return null;
    const close = meters.filter(
      (m) =>
        !registerNumbers.has(m.meterNumber) &&
        m.meterNumber.length === row.meterNumber.length &&
        editDistance(m.meterNumber, row.meterNumber) <= 2 &&
        [m.customer?.name, m.usageRecords[0]?.customerName].some(
          (n) => n && firstWord(n) === firstWord(row.customer!),
        ),
    );
    return close.length === 1 ? close[0] : null;
  };

  // Zones are looked up at every level, so a zone already nested is found, not duplicated.
  const zones = await tx.waterZone.findMany({ orderBy: { createdAt: "asc" } });
  const zoneByKey = new Map<string, { id: string; name: string; parentZoneId: string | null }>();
  for (const z of zones) if (!zoneByKey.has(zoneKey(z.name))) zoneByKey.set(zoneKey(z.name), z);
  let draftIds = 0;
  const zoneLabel = (key: string) => (/^\d+$/.test(key) ? `Zone ${key}` : key);
  // Finds or creates a zone and makes sure it sits inside its outer zone.
  const ensureZone = async (key: string, label: string): Promise<string> => {
    const outerKey = SUB_ZONES.get(key);
    const outerId = outerKey ? await ensureZone(outerKey, zoneLabel(outerKey)) : null;
    const outerName = outerKey ? zoneByKey.get(outerKey)!.name : null;
    const known = zoneByKey.get(key);
    if (!known) {
      const name = /^\d+$/.test(key) ? `Zone ${key}` : label;
      const id = DRY_RUN
        ? `new-zone-${key}`
        : (await tx.waterZone.create({ data: { name, parentZoneId: outerId } })).id;
      zoneByKey.set(key, { id, name, parentZoneId: outerId });
      report.newZones.push(outerName ? `${name} (inside ${outerName})` : name);
      return id;
    }
    if (outerId && known.parentZoneId !== outerId) {
      if (known.parentZoneId) {
        report.zoneConflicts.push(
          `${known.name} already sits inside another zone, so it was not moved into ${outerName}`,
        );
      } else {
        if (!DRY_RUN) {
          await tx.waterZone.update({ where: { id: known.id }, data: { parentZoneId: outerId } });
        }
        known.parentZoneId = outerId;
        report.nestedZones.push(`${known.name} is now inside ${outerName}`);
      }
    }
    return known.id;
  };
  // Null is the main line. Undefined means the register does not say clearly.
  const resolveZone = async (row: RegisterRow): Promise<string | null | undefined> => {
    if (!row.zone) return undefined;
    if (/^main/i.test(row.zone)) return null;
    if (/[/&,]/.test(row.zone)) {
      report.unclearZones.push(
        `${row.meterNumber} (zone "${row.zone}", plot ${row.plotNo ?? "—"})`,
      );
      return undefined;
    }
    return ensureZone(zoneKey(row.zone), row.zone);
  };

  // The same name on the same plot is one person with several meters.
  const customerByNamePlot = new Map<string, string>();
  const namePlotKey = (row: RegisterRow) =>
    row.customer && row.plotNo ? `${row.customer.toLowerCase()}|${row.plotNo.toLowerCase()}` : null;
  const touchedCustomers = new Set<string>();

  for (const row of rows) {
    let meter = byNumber.get(row.meterNumber) ?? null;
    if (!meter) {
      meter = typoMatch(row);
      if (meter) {
        report.typoMatchedNumbers.add(meter.meterNumber);
        report.typoMatches.push(
          `register ${row.meterNumber} (${row.customer}) -> vending account ${meter.meterNumber}`,
        );
      }
    }
    if (meter && meter.meterType !== "household") {
      report.skipped.push(`${row.meterNumber} is a ${meter.meterType} meter, left as it is`);
      continue;
    }
    if (meter) report.matched++;
    else report.newMeters.push(`${row.meterNumber} (${row.customer ?? "no name"})`);

    const zoneId = await resolveZone(row);
    const key = namePlotKey(row);
    let customerId = meter?.customerId ?? null;
    if (row.customer) {
      const current = meter?.customer;
      const ownRecord =
        current && (current._count.meters <= 1 || sameName(current.name, row.customer));
      if (current && ownRecord) {
        if (current.name !== row.customer || (zoneId !== undefined && current.zoneId !== zoneId)) {
          report.customersUpdated++;
          if (!DRY_RUN) {
            await tx.waterCustomer.update({
              where: { id: current.id },
              data: { name: row.customer, ...(zoneId !== undefined && { zoneId }) },
            });
          }
        }
      } else {
        const shared = key ? customerByNamePlot.get(key) : undefined;
        if (shared) customerId = shared;
        else {
          report.customersCreated++;
          customerId = DRY_RUN
            ? `new-customer-${++draftIds}`
            : (
                await tx.waterCustomer.create({
                  data: { name: row.customer, zoneId: zoneId ?? null },
                })
              ).id;
        }
      }
      if (key && customerId) customerByNamePlot.set(key, customerId);
      if (customerId) touchedCustomers.add(customerId);
    }

    const retire = !row.inUse && (!meter || meter.isActive);
    const retirement = retire
      ? {
          isActive: false,
          deactivatedAt: new Date(),
          inactiveNote: ["Not in use on the meter register", row.notes].filter(Boolean).join(". "),
        }
      : {};
    if (retire) {
      report.retired.push(`${row.meterNumber} ${row.customer ?? ""}`.trim());
      const last = meter?.usageRecords[0]?.recordedAt;
      if (last && recentFrom && last >= recentFrom) {
        report.stillBuying.push(
          `${row.meterNumber} ${row.customer ?? ""} — last bought ${last.toISOString().slice(0, 10)}`,
        );
      }
    }
    if (row.inUse && meter && !meter.isActive) {
      report.inactiveButInUse.push(`${row.meterNumber} ${row.customer ?? ""}`.trim());
    }
    if (zoneId !== undefined && (!meter || meter.zoneId !== zoneId)) report.placed++;
    if (row.inUse && row.notes && !/^active$/i.test(row.notes)) {
      report.followUp.push(`${row.sn} ${row.meterNumber} ${row.customer ?? ""} — ${row.notes}`);
    }
    if (DRY_RUN) continue;

    const data = {
      ...(row.plotNo && { plotNo: row.plotNo }),
      ...(zoneId !== undefined && { zoneId }),
      ...(customerId && { customerId }),
      ...retirement,
    };
    if (meter) await tx.waterMeter.update({ where: { id: meter.id }, data });
    else {
      await tx.waterMeter.create({
        data: {
          meterNumber: row.meterNumber,
          meterType: "household",
          vendingSystem: "mpaya",
          ...data,
        },
      });
    }
  }

  report.notInRegister = meters
    .filter(
      (m) =>
        m.meterType === "household" &&
        !registerNumbers.has(m.meterNumber) &&
        !report.typoMatchedNumbers.has(m.meterNumber),
    )
    .map((m) => m.meterNumber);

  if (!DRY_RUN) {
    // A household is active while it has at least one meter in use.
    for (const id of touchedCustomers) {
      const active = await tx.waterMeter.count({ where: { customerId: id, isActive: true } });
      await tx.waterCustomer.update({ where: { id }, data: { isActive: active > 0 } });
    }
    // Past payments follow the meter's customer, so customer pages show their history.
    const owned = await tx.waterMeter.findMany({
      where: { customerId: { not: null } },
      select: { id: true, customerId: true },
    });
    for (const m of owned) {
      const linked = await tx.waterUsageRecord.updateMany({
        where: { meterId: m.id, customerId: null },
        data: { customerId: m.customerId },
      });
      report.paymentsLinked += linked.count;
    }
  }
  return report;
}

function list(title: string, items: string[]) {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length})`);
  for (const item of items) console.log(`  ${item}`);
}

async function main() {
  if (!FILE || !fs.existsSync(FILE)) {
    throw new Error(
      "Meter register not found. Put Meter_Register.xlsx in backend/ or pass --file.",
    );
  }
  console.log(`${DRY_RUN ? "Dry run — nothing will be saved. " : ""}Database: ${databaseLabel()}`);
  const { rows, unreadable } = readRegister(FILE);
  const numbers = rows.map((r) => r.meterNumber);
  const repeated = rows.filter((r, i) => numbers.indexOf(r.meterNumber) !== i);
  if (repeated.length > 0) {
    throw new Error(
      `Meter numbers appear more than once in the register: ${repeated.map((r) => r.meterNumber).join(", ")}. Fix the file and run again.`,
    );
  }
  const inUse = rows.filter((r) => r.inUse).length;
  console.log(
    `${path.basename(FILE)}: ${rows.length} meters — ${inUse} in use, ${rows.length - inUse} not in use`,
  );

  const report = await prisma.$transaction((tx) => run(tx, rows), {
    maxWait: 10_000,
    timeout: 120_000,
  });

  const verb = DRY_RUN ? "Would" : "Did";
  console.log(`\n${verb}:`);
  console.log(`  match ${report.matched} meters already in the system`);
  console.log(`  register ${report.newMeters.length} new meters`);
  console.log(`  create ${report.customersCreated} customers, update ${report.customersUpdated}`);
  console.log(`  place ${report.placed} meters in a zone`);
  console.log(`  take ${report.retired.length} meters out of use`);
  if (!DRY_RUN) console.log(`  link ${report.paymentsLinked} past payments to their customer`);

  list("New zones", report.newZones);
  list("Zones placed inside another zone", report.nestedZones);
  list("CHECK — zone layout", report.zoneConflicts);
  list("New meters (in the register, never seen in a vending file)", report.newMeters);
  list("Register number corrected to the vending account", report.typoMatches);
  list("Taken out of use", report.retired);
  list(
    `CHECK — taken out of use but bought water in the last ${RECENT_DAYS} days of payments`,
    report.stillBuying,
  );
  list("CHECK — zone not clear in the register, meter left unplaced", report.unclearZones);
  list(
    "CHECK — in use in the register but already out of use here (left out of use)",
    report.inactiveButInUse,
  );
  list("CHECK — notes written on the register", report.followUp);
  list("In the system but not in the register (left as they are)", report.notInRegister);
  list("Skipped", [...report.skipped, ...unreadable]);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
