/**
 * Builds a throwaway database holding the ORIGINAL department_reports shape with
 * real-looking rows, runs the reports migration against it exactly as production
 * will, then checks the result. Drops the database afterwards either way.
 */
const { PrismaClient } = require("@prisma/client");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const BE = "C:/dev/SYSTEMS/AIMS/backend";
const MIGRATION = `${BE}/prisma/migrations/20260921090000_reports_generalised/migration.sql`;
const TEST_DB = "aims_migration_dryrun";

const env = fs.readFileSync(`${BE}/.env`, "utf8");
const url = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)[1];
const base = url.replace(/\/[^/?]+(\?|$)/, "/$1");
const testUrl = base.replace(/\/(\?|$)/, `/${TEST_DB}$1`);

const admin = new PrismaClient({ datasources: { db: { url } } });
let test = null;
let pass = 0;
let fail = 0;
const ok = (l, c, d = "") => {
  c ? pass++ : fail++;
  console.log(
    `${c ? "PASS" : "FAIL"} ${l}${!c && d !== "" ? ` -> ${String(d).slice(0, 220)}` : ""}`,
  );
};

// The original tables, lifted from the migration that created them.
const ORIGINAL = [
  "CREATE TABLE `departments` (`id` CHAR(36) NOT NULL, `code` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
  "CREATE TABLE `users` (`id` CHAR(36) NOT NULL, `email` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
  `CREATE TABLE \`department_reports\` (
    \`id\` CHAR(36) NOT NULL,
    \`department_id\` CHAR(36) NOT NULL,
    \`title\` VARCHAR(191) NOT NULL,
    \`period_type\` ENUM('monthly', 'quarterly', 'annual', 'other') NOT NULL DEFAULT 'monthly',
    \`period_start\` DATE NOT NULL,
    \`period_end\` DATE NOT NULL,
    \`summary\` TEXT NULL,
    \`figures\` JSON NOT NULL,
    \`status\` ENUM('draft', 'submitted', 'changes_requested', 'approved') NOT NULL DEFAULT 'draft',
    \`submitted_by\` CHAR(36) NULL,
    \`submitted_at\` DATETIME(3) NULL,
    \`reviewed_by\` CHAR(36) NULL,
    \`reviewed_at\` DATETIME(3) NULL,
    \`created_by\` CHAR(36) NOT NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL,
    INDEX \`department_reports_department_id_status_idx\`(\`department_id\`, \`status\`),
    INDEX \`department_reports_period_end_idx\`(\`period_end\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE \`department_report_messages\` (
    \`id\` CHAR(36) NOT NULL,
    \`report_id\` CHAR(36) NOT NULL,
    \`author_id\` CHAR(36) NOT NULL,
    \`kind\` ENUM('comment', 'submitted', 'resubmitted', 'changes_requested', 'approved') NOT NULL DEFAULT 'comment',
    \`parent_id\` CHAR(36) NULL,
    \`body\` TEXT NOT NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`department_report_messages_report_id_created_at_idx\`(\`report_id\`, \`created_at\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  "ALTER TABLE `department_reports` ADD CONSTRAINT `department_reports_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
  "ALTER TABLE `department_reports` ADD CONSTRAINT `department_reports_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
  "ALTER TABLE `department_reports` ADD CONSTRAINT `department_reports_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE",
  "ALTER TABLE `department_report_messages` ADD CONSTRAINT `department_report_messages_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `department_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
  "ALTER TABLE `department_report_messages` ADD CONSTRAINT `department_report_messages_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
  "ALTER TABLE `department_report_messages` ADD CONSTRAINT `department_report_messages_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `department_report_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE",
];

// Rows shaped like the ones production is holding right now.
const SEED = [
  "INSERT INTO `departments` (`id`,`code`,`name`) VALUES ('d-it','it','Information Technology'),('d-hr','hr','Human Resources')",
  "INSERT INTO `users` (`id`,`email`) VALUES ('u-1','amos@example.com'),('u-2','grace@example.com')",
  `INSERT INTO \`department_reports\`
     (\`id\`,\`department_id\`,\`title\`,\`period_start\`,\`period_end\`,\`summary\`,\`figures\`,\`status\`,\`submitted_by\`,\`submitted_at\`,\`created_by\`,\`updated_at\`)
   VALUES
     ('r-1','d-it','IT — August','2026-08-01','2026-08-31','Tickets rose.','[{"label":"Tickets opened","value":"128"}]','approved','u-1','2026-09-02 08:00:00','u-1',NOW(3)),
     ('r-2','d-hr','HR — August','2026-08-01','2026-08-31',NULL,'[]','changes_requested','u-2','2026-09-03 08:00:00','u-2',NOW(3)),
     ('r-3','d-it','IT — September','2026-09-01','2026-09-30',NULL,'[]','draft',NULL,NULL,'u-1',NOW(3)),
     ('r-4','d-hr','HR — July','2026-07-01','2026-07-31',NULL,'[]','approved','u-2','2026-08-02 08:00:00','u-2',NOW(3))`,
  `INSERT INTO \`department_report_messages\` (\`id\`,\`report_id\`,\`author_id\`,\`kind\`,\`body\`,\`created_at\`) VALUES
     ('m-1','r-1','u-1','submitted','Sent for your review.','2026-09-02 08:00:00'),
     ('m-2','r-1','u-1','changes_requested','Explain the ticket jump.','2026-09-03 08:00:00'),
     ('m-3','r-1','u-1','resubmitted','Updated and sent again.','2026-09-04 08:00:00'),
     ('m-4','r-1','u-1','approved','Approved.','2026-09-05 08:00:00'),
     ('m-5','r-2','u-2','submitted','Sent for your review.','2026-09-03 08:00:00'),
     ('m-6','r-2','u-2','changes_requested','Numbers do not add up.','2026-09-04 08:00:00')`,
];

(async () => {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await admin.$executeRawUnsafe(
    `CREATE DATABASE \`${TEST_DB}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  test = new PrismaClient({ datasources: { db: { url: testUrl } } });
  for (const sql of ORIGINAL) await test.$executeRawUnsafe(sql);
  for (const sql of SEED) await test.$executeRawUnsafe(sql);
  console.log("Built a database holding the original shape and four reports.\n");

  // Run it the way the server will: Prisma reads and splits the file itself.
  const run = () =>
    execFileSync("npx", ["prisma", "db", "execute", "--url", testUrl, "--file", MIGRATION], {
      cwd: BE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

  try {
    run();
    ok("the migration runs from the original shape", true);
  } catch (e) {
    const detail = `${e.message}
${e.stdout ?? ""}
${e.stderr ?? ""}`;
    ok("the migration runs from the original shape", false, "see below");
    console.error("\n--- what the database said ---");
    console.error(detail.slice(0, 2000));
    throw new Error("stopped: the migration itself failed");
  }

  const rows = await test.$queryRawUnsafe(
    "SELECT `id`,`kind`,`template`,`subject_id`,`department_id`,`reviewer_kind`,`submission_count`,`last_review_note` FROM `reports` ORDER BY `id`",
  );
  const by = new Map(rows.map((r) => [r.id, r]));

  ok("every report survived", rows.length === 4, `${rows.length}`);
  ok(
    "each one is a departmental report",
    rows.every((r) => r.kind === "department"),
    JSON.stringify(rows.map((r) => r.kind)),
  );
  ok(
    "its department became its subject",
    rows.every((r) => r.subject_id === r.department_id),
    JSON.stringify(rows.map((r) => r.subject_id)),
  );
  ok(
    "the CEO still decides on them",
    rows.every((r) => r.reviewer_kind === "ceo"),
    JSON.stringify(rows.map((r) => r.reviewer_kind)),
  );
  ok(
    "a report sent and resent counts as two",
    Number(by.get("r-1").submission_count) === 2,
    JSON.stringify(by.get("r-1")),
  );
  ok(
    "a report sent once counts as one",
    Number(by.get("r-2").submission_count) === 1,
    JSON.stringify(by.get("r-2")),
  );
  ok(
    "a draft counts as none",
    Number(by.get("r-3").submission_count) === 0,
    JSON.stringify(by.get("r-3")),
  );
  ok(
    "a report sent with no message still counts as one",
    Number(by.get("r-4").submission_count) === 1,
    JSON.stringify(by.get("r-4")),
  );
  ok(
    "the last change note is lifted out of the thread",
    by.get("r-2").last_review_note === "Numbers do not add up.",
    JSON.stringify(by.get("r-2").last_review_note),
  );
  ok(
    "a report with no change request has no note",
    by.get("r-3").last_review_note === null,
    JSON.stringify(by.get("r-3").last_review_note),
  );

  const msgs = await test.$queryRawUnsafe("SELECT COUNT(*) AS n FROM `report_messages`");
  ok("every message survived", Number(msgs[0].n) === 6, String(msgs[0].n));

  const ddl = Object.values((await test.$queryRawUnsafe("SHOW CREATE TABLE `reports`"))[0])[1];
  ok(
    "the one-per-period rule is in place",
    ddl.includes("reports_kind_subject_id_period_start_period_end_key"),
    "missing",
  );
  ok(
    "the foreign keys came back",
    ddl.includes("reports_department_id_fkey") && ddl.includes("reports_created_by_fkey"),
    "missing",
  );
  ok(
    "a project or person report needs no department",
    /`department_id` char\(36\) DEFAULT NULL/i.test(ddl),
    "department_id still NOT NULL",
  );

  // Running it again must be a no-op, which is what makes a half-finished run recoverable.
  try {
    run();
    const after = await test.$queryRawUnsafe("SELECT COUNT(*) AS n FROM `reports`");
    const r1 = await test.$queryRawUnsafe(
      "SELECT `submission_count` FROM `reports` WHERE `id` = 'r-1'",
    );
    ok(
      "running it a second time changes nothing",
      Number(after[0].n) === 4 && Number(r1[0].submission_count) === 2,
      String(r1[0].submission_count),
    );
  } catch (e) {
    ok("running it a second time changes nothing", false, `${e.stdout ?? ""}${e.stderr ?? ""}`);
  }

  console.log(`\n${pass}/${pass + fail} passed`);
})()
  .catch((e) => {
    console.error(`\n${e.message}`);
    fail = fail || 1;
  })
  .finally(async () => {
    if (test) await test.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.$disconnect();
    console.log("Throwaway database dropped.");
    process.exit(fail ? 1 : 0);
  });
