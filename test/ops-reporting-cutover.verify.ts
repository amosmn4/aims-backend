import "reflect-metadata";
import assert from "node:assert/strict";
import { ModulesContainer, NestFactory } from "@nestjs/core";

async function verify() {
  const url = new URL(process.env.OPS_TEST_DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_verify") ||
    process.env.DATABASE_URL !== url.toString()
  )
    throw new Error("Use a separate local *_verify database.");
  const { AppModule } = await import("../src/app.module");
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const modules = app.get(ModulesContainer);
    const providers = [...modules.values()].flatMap((module) =>
      [...module.providers.values()].map((provider) => provider.metatype?.name),
    );
    assert.ok(!providers.includes("ReportSchedulesService"));
    assert.ok(!providers.includes("ReportsService"));
    assert.ok(!providers.includes("FinanceReportsService"));
    assert.ok(providers.includes("WeeklyDeliveryService"));
    assert.ok(providers.includes("OpsWorkflowsService"));
    const base = await app.getUrl();
    assert.equal((await fetch(`${base}/api/v1/reports`)).status, 404);
    assert.equal((await fetch(`${base}/api/v1/ops/auth/status`)).status, 200);
    process.stdout.write(
      "Combined backend reporting cutover passed: legacy report modules and schedules are absent; Ops reporting workers and authentication are active.\n",
    );
  } finally {
    await app.close();
  }
}
verify().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : "Cutover verification failed"}\n`);
  process.exitCode = 1;
});
