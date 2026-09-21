/**
 * Run this on the server BEFORE `npx prisma migrate deploy` brings in the reports
 * migration, and again after, to confirm nothing was lost.
 *
 *   node scripts/check-reports-migration.cjs
 *
 * It only reads. It changes nothing.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);
const one = async (sql) => Number(Object.values((await q(sql))[0])[0]);
const exists = async (table) =>
  (await one(
    `SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`,
  )) > 0;

let blockers = 0;
const line = (label, value) => console.log(`  ${label.padEnd(44)} ${value}`);
const blocker = (why) => {
  blockers += 1;
  console.log(`\n  STOP  ${why}`);
};

(async () => {
  const version = (await q("SELECT VERSION() AS v"))[0].v;
  const isMariaDb = /mariadb/i.test(version);

  console.log("\nDatabase");
  line("Server", version);
  line("Engine", isMariaDb ? "MariaDB" : "MySQL");
  console.log(
    "\n  The migration is written with information_schema guards only, so both are fine.",
  );

  const before = await exists("department_reports");
  const after = await exists("reports");

  console.log("\nWhere this database is");
  line("department_reports still present", before ? "yes" : "no");
  line("reports present", after ? "yes" : "no");

  if (before && !after) {
    console.log("\n  Not migrated yet. Checks below run against the old table.");
  } else if (!before && after) {
    console.log("\n  Already migrated. Checks below confirm the result.");
  } else if (before && after) {
    blocker(
      "Both tables exist. A previous run stopped part way. The migration is safe to " +
        "re-run, but look at both tables before you do.",
    );
  } else {
    blocker(
      "Neither table exists. This database has no reports at all — check you are on the right one.",
    );
  }

  const table = after ? "reports" : "department_reports";
  const messages = after ? "report_messages" : "department_report_messages";
  if (!(await exists(table))) {
    console.log("\nNothing more to check.");
    await prisma.$disconnect();
    process.exit(blockers ? 1 : 0);
  }

  const rows = await one(`SELECT COUNT(*) FROM \`${table}\``);
  const msgs = (await exists(messages)) ? await one(`SELECT COUNT(*) FROM \`${messages}\``) : 0;

  console.log("\nWhat is in there");
  line("Reports", rows);
  line("Messages on them", msgs);

  if (rows === 0) {
    console.log(
      "\n  No reports yet, so the migration has nothing to move. It will just reshape the table.",
    );
    await prisma.$disconnect();
    process.exit(blockers ? 1 : 0);
  }

  // The one thing that can stop the migration: two reports for the same period.
  const dupes = await q(
    `SELECT department_id, period_start, period_end, COUNT(*) AS n
       FROM \`${table}\`
      GROUP BY department_id, period_start, period_end
     HAVING COUNT(*) > 1`,
  );
  console.log("\nThe one thing that can stop it");
  line("Departments with two reports for one period", dupes.length);
  if (dupes.length > 0) {
    blocker(
      "Two reports exist for the same department and period. The migration adds a rule " +
        "that forbids this, and will stop rather than pick one. Merge or delete the extras first:",
    );
    for (const d of dupes) {
      console.log(
        `        department ${d.department_id}  ${String(d.period_start).slice(0, 10)} → ${String(d.period_end).slice(0, 10)}  (${d.n} reports)`,
      );
    }
  }

  const orphans = await one(`SELECT COUNT(*) FROM \`${table}\` WHERE department_id IS NULL`);
  if (orphans > 0) {
    blocker(`${orphans} report(s) have no department. The migration will stop rather than guess.`);
  }

  if (after) {
    console.log("\nAfter the migration");
    const noSubject = await one("SELECT COUNT(*) FROM `reports` WHERE `subject_id` IS NULL");
    const wrongSubject = await one(
      "SELECT COUNT(*) FROM `reports` WHERE `kind` = 'department' AND `subject_id` <> `department_id`",
    );
    const sent = await one(
      "SELECT COUNT(*) FROM `reports` WHERE `submitted_at` IS NOT NULL AND `submission_count` = 0",
    );
    line("Reports with no subject", noSubject);
    line("Departmental reports whose subject is wrong", wrongSubject);
    line("Sent reports not counted as sent", sent);
    if (noSubject || wrongSubject || sent) {
      blocker(
        "The backfill did not finish. Do not let people use reports until this is looked at.",
      );
    }
  }

  console.log(
    blockers === 0
      ? "\nNothing in the way. Safe to deploy.\n"
      : `\n${blockers} thing(s) to sort out first.\n`,
  );
  await prisma.$disconnect();
  process.exit(blockers ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
