const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

async function check() {
  const failures = [];
  const warnings = [];
  const env = process.env;
  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
    if (!env[key] || env[key].length < 32 || /^(change|replace|example|your[-_])/i.test(env[key]))
      failures.push(`${key}: use a strong secret of at least 32 characters.`);
  }
  if (env.NODE_ENV !== "production")
    failures.push("NODE_ENV must be production for deployment verification.");
  if (
    !Number.isInteger(Number(env.OPS_TRUST_PROXY_HOPS)) ||
    Number(env.OPS_TRUST_PROXY_HOPS) < 1 ||
    Number(env.OPS_TRUST_PROXY_HOPS) > 5
  )
    failures.push(
      "Set OPS_TRUST_PROXY_HOPS for the trusted reverse proxy chain (1 for native TLS proxy, 2 for the supplied Docker setup).",
    );
  try {
    const origin = new URL(env.OPS_FRONTEND_URL);
    if (
      origin.protocol !== "https:" ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    )
      throw new Error();
  } catch {
    failures.push("OPS_FRONTEND_URL must be the production HTTPS origin.");
  }
  if (
    !["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"].every(
      (name) => !!env[name],
    )
  )
    failures.push("SMTP configuration is incomplete.");
  if (env.OPS_EMAIL_JOBS_ENABLED !== "true")
    failures.push("OPS_EMAIL_JOBS_ENABLED must be true for scheduled weekly email delivery.");
  if (!env.S3_BUCKET) {
    try {
      fs.accessSync(path.resolve("uploads"), fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      failures.push("The shared uploads directory must exist and be readable and writable.");
    }
    warnings.push(
      "Local uploads require a persistent volume shared with the legacy API and a backup.",
    );
  } else if (
    !["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].every((name) => !!env[name])
  )
    failures.push("S3 configuration is incomplete.");
  const db = new PrismaClient();
  try {
    const applied = await db.$queryRawUnsafe(
      "SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    const finished = new Set(applied.map((row) => row.name));
    const pending = fs
      .readdirSync(path.join(__dirname, "../prisma/migrations"), { withFileTypes: true })
      .filter((row) => row.isDirectory() && !finished.has(row.name))
      .map((row) => row.name);
    if (pending.length) failures.push(`Pending migrations: ${pending.join(", ")}`);
    const broken = await db.$queryRawUnsafe(
      "SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL",
    );
    if (broken.length)
      failures.push("A database migration is unfinished. Resolve it before deployment.");
    if (!(await db.opsState.count({ where: { id: "workspace" } })))
      failures.push("Run Ops bootstrap against the intended existing CEO identity.");
    if (
      !(await db.opsStaff.count({
        where: { role: "ceo", active: true, user: { isActive: true, passwordHash: { not: null } } },
      }))
    )
      failures.push("At least one active CEO account with a password is required.");
    const weekly = await db.opsWeeklySettings.findUnique({ where: { id: "workspace" } });
    if (!weekly) failures.push("The CEO must save the weekly reporting schedules.");
    else {
      if (!weekly.settings.planEmailEnabled)
        failures.push("Enable the weekly plans email in Reporting schedules.");
      if (!weekly.settings.reportEmailEnabled)
        failures.push("Enable the weekly reports email in Reporting schedules.");
    }
    const uncertain = await db.opsWeeklyDelivery.count({
      where: { status: { in: ["failed", "uncertain"] } },
    });
    if (uncertain) warnings.push(`${uncertain} weekly email deliveries need CEO attention.`);
  } catch {
    failures.push(
      "Database checks failed. Verify connectivity, migrations and generated Prisma client.",
    );
  } finally {
    await db.$disconnect();
  }
  console.log(JSON.stringify({ ready: failures.length === 0, failures, warnings }, null, 2));
  if (failures.length) process.exitCode = 1;
}
void check().catch(() => {
  console.error("Deployment readiness verification failed.");
  process.exitCode = 1;
});
