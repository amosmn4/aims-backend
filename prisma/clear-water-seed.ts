// Removes seeded and uploaded water vending data so a fresh seed can replace it.
//   npm run water:clear-seed            show what would be removed, change nothing
//   npm run water:clear-seed -- --yes   remove it
// Removes: payments that came from seeds or file uploads, their upload batches, the household
// meters and customers those files created, and saved AI insights (they describe the old data).
// Keeps: zones, main and bulk meters, dial readings, payments typed in by hand, AI chat history,
// and any household meter or customer that staff have put in a zone, given readings or a phone.
import { PrismaClient, type Prisma } from "@prisma/client";
import { databaseLabel } from "./water-seed-files";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--yes");

// Saved AI insights describe the old data, so they go too — but only if this server's Prisma
// client already knows the table. An older client just skips them instead of failing.
type InsightModel = {
  count: () => Promise<number>;
  deleteMany: (args: Record<string, never>) => Promise<{ count: number }>;
};
const insightsOf = (client: unknown): InsightModel | null => {
  const model = (client as { waterAiInsight?: InsightModel }).waterAiInsight;
  return model && typeof model.count === "function" ? model : null;
};

const seededRecords: Prisma.WaterUsageRecordWhereInput = { source: { in: ["seed", "upload"] } };
const removableMeters: Prisma.WaterMeterWhereInput = {
  meterType: "household",
  zoneId: null,
  readings: { none: {} },
  replacesMeterId: null,
  replacedByMeter: { is: null },
  usageRecords: { none: { source: "manual" } },
};

async function main() {
  console.log(`Database: ${databaseLabel()}`);
  const insightsModel = insightsOf(prisma);
  const [records, amount, uploads, meters, keptMeters, insights, manual] = await Promise.all([
    prisma.waterUsageRecord.count({ where: seededRecords }),
    prisma.waterUsageRecord.aggregate({ where: seededRecords, _sum: { amountPaid: true } }),
    prisma.waterUsageUpload.findMany({ select: { fileName: true, recordCount: true } }),
    prisma.waterMeter.count({ where: removableMeters }),
    prisma.waterMeter.count({ where: { meterType: "household", NOT: removableMeters } }),
    insightsModel ? insightsModel.count() : Promise.resolve(0),
    prisma.waterUsageRecord.count({ where: { source: "manual" } }),
  ]);
  const customers = await prisma.waterCustomer.count({
    where: {
      zoneId: null,
      phone: null,
      meters: { every: removableMeters },
      usageRecords: { none: { source: "manual" } },
    },
  });

  console.log(`\n${APPLY ? "Removing" : "Would remove"}:`);
  console.log(
    `  ${records} payments from seeds and uploads (KES ${Number(amount._sum.amountPaid ?? 0).toLocaleString("en-KE")})`,
  );
  console.log(
    `  ${uploads.length} upload batches${uploads.length ? `: ${uploads.map((u: { fileName: string; recordCount: number }) => `${u.fileName} (${u.recordCount})`).join(", ")}` : ""}`,
  );
  console.log(`  ${meters} household meters and ${customers} customers created from those files`);
  console.log(
    insightsModel
      ? `  ${insights} saved AI insights`
      : "  (Saved AI insights skipped — run 'npx prisma generate' so this server knows that table.)",
  );
  console.log(
    `\nKeeping: zones, main and bulk meters, dial readings, ${manual} hand-entered payments, and ${keptMeters} household meters staff have set up (zone, readings or replacements).`,
  );

  if (!APPLY) {
    console.log(
      "\nNothing was changed. Run `npm run water:clear-seed -- --yes` to remove the items above.",
    );
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.waterUsageRecord.deleteMany({ where: seededRecords });
      await tx.waterUsageUpload.deleteMany({ where: { records: { none: {} } } });
      await tx.waterMeter.deleteMany({ where: { ...removableMeters, usageRecords: { none: {} } } });
      await tx.waterCustomer.deleteMany({
        where: { zoneId: null, phone: null, meters: { none: {} }, usageRecords: { none: {} } },
      });
      const txInsights = insightsOf(tx);
      if (txInsights) await txInsights.deleteMany({});
    },
    { timeout: 120_000 },
  );

  const [left, leftMeters] = await Promise.all([
    prisma.waterUsageRecord.count(),
    prisma.waterMeter.count(),
  ]);
  console.log(
    `\nDone. ${left} payments and ${leftMeters} meters remain. Load the new files with \`npm run water:seed\`.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
