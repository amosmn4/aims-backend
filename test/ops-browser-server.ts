import { DiscoveryService } from "@nestjs/core";
import { startWeeklyEmailFixture } from "./ops-weekly-email-fixture";
import { WeeklyDeliveryService } from "../src/ops/weekly/weekly-delivery.service";
import { startLedgerFixture } from "./ops-ledger-fixture";
import { PaymentLedgerModule } from "../src/payment-ledger/payment-ledger.module";
import { PaymentLedgerSyncService } from "../src/payment-ledger/payment-ledger-sync.service";
import { ScheduleModule } from "@nestjs/schedule";
import "reflect-metadata";
import { Global, Module, ValidationPipe } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import { PrismaService } from "../src/prisma/prisma.service";
import { WaterController } from "../src/water/water.controller";
import { WaterExpensesController } from "../src/water/water-expenses.controller";
import { opsFeatureProviders } from "../src/ops/modules/ops-feature.providers";
import { StorageModule } from "../src/storage/storage.module";
import { BlogModule } from "../src/marketing/blog/blog.module";
import { PrismaExceptionFilter } from "../src/common/prisma-exception.filter";
import { OpsModule } from "../src/ops/ops.module";
import { JwtStrategy } from "../src/auth/strategies/jwt.strategy";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";
import { RolesGuard } from "../src/auth/guards/roles.guard";
import { ViewAsGuard } from "../src/auth/guards/view-as.guard";
import { CapabilityGuard } from "../src/auth/guards/capability.guard";
import { SanitizeInputPipe } from "../src/common/sanitize";
import { bootstrapOps } from "../prisma/ops-bootstrap";

async function start() {
  const raw = process.env.OPS_TEST_DATABASE_URL;
  if (!raw) throw new Error("Set OPS_TEST_DATABASE_URL to a separate local *_verify database.");
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.endsWith("_verify"))
    throw new Error("Browser verification must use a separate local *_verify database.");
  const db = new PrismaClient({ datasourceUrl: raw });
  const passwordHash = await bcrypt.hash("OpsBrowser2026!", 4);
  const ceo = await db.user.upsert({
    where: { email: "ceo@ops-verify.local" },
    create: {
      email: "ceo@ops-verify.local",
      fullName: "Browser CEO",
      passwordHash,
      roles: { create: { role: "ceo" } },
    },
    update: {},
  });
  await bootstrapOps(db, ceo.email);
  for (const fixture of [
    { email: "staff@ops-verify.local", name: "Browser Staff", dept: "hr" },
    { email: "it@ops-verify.local", name: "Browser IT", dept: "it" },
  ]) {
    const user = await db.user.upsert({
      where: { email: fixture.email },
      create: { email: fixture.email, passwordHash },
      update: {},
    });
    await db.opsStaff.upsert({
      where: { userId: user.id },
      create: { userId: user.id, name: fixture.name, title: "Consultant", dept: fixture.dept },
      update: {},
    });
  }
  const config = new ConfigService({
    JWT_ACCESS_SECRET: "ops-browser-verification-only",
    NODE_ENV: "test",
    OPS_FRONTEND_URL: "http://127.0.0.1:5176",
  });
  config.set("SMTP_HOST", "");
  config.set("OPS_EMAIL_JOBS_ENABLED", false);
  config.set("OPS_WEEKLY_TEST_NOW", "2026-11-20T16:00:00Z");
  const weeklyEmailFixture =
    process.env.OPS_WEEKLY_TEST_EMAIL === "1" ? await startWeeklyEmailFixture() : null;
  if (weeklyEmailFixture) {
    config.set("SMTP_HOST", "127.0.0.1");
    config.set("SMTP_PORT", 2526);
    config.set("SMTP_USER", "fixture");
    config.set("SMTP_PASSWORD", "fixture-only");
    config.set("SMTP_FROM", "Ops <ops@fixture.invalid>");
  }
  config.set("S3_BUCKET", "");
  config.set("OPENAI_API_KEY", "");
  config.set("GEMINI_API_KEY", "");
  config.set("PUBLIC_BLOG_API_KEY", "ops-module-verification-only");
  config.set("PAYMENT_GATEWAY_URL", "");
  config.set("PAYMENT_GATEWAY_BRIDGE_KEY", "");
  const ledgerFixture =
    process.env.OPS_LEDGER_TEST_GATEWAY === "1" ? await startLedgerFixture(db) : null;
  if (ledgerFixture) {
    config.set("PAYMENT_GATEWAY_URL", "http://127.0.0.1:4003/api/payment-gateway");
    config.set("PAYMENT_GATEWAY_BRIDGE_KEY", "ops-ledger-fixture-only");
  }
  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: db },
      { provide: ConfigService, useValue: config },
    ],
    exports: [PrismaService, ConfigService],
  })
  class Infrastructure {}
  @Module({
    imports: [
      ScheduleModule.forRoot(),
      Infrastructure,
      OpsModule,
      BlogModule,
      StorageModule,
      PaymentLedgerModule,
    ],
    controllers: [WaterController, WaterExpensesController],
    providers: [
      ...opsFeatureProviders,
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_GUARD, useClass: ViewAsGuard },
      { provide: APP_GUARD, useClass: CapabilityGuard },
    ],
  })
  class BrowserApp {}
  const app = await NestFactory.create(BrowserApp, { logger: ["error", "warn"] });
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.useGlobalPipes(
    new SanitizeInputPipe(),
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.listen(4001, "127.0.0.1");
  weeklyEmailFixture?.setReset(async () => {
    await db.opsWeeklyReport.deleteMany({
      where: {
        author: { user: { email: { in: ["staff@ops-verify.local", "it@ops-verify.local"] } } },
      },
    });
    await db.opsWeeklyDelivery.deleteMany({
      where: { recipient: { user: { email: "ceo@ops-verify.local" } } },
    });
    await db.opsWeeklySettings.deleteMany({ where: { id: "workspace" } });
  });
  weeklyEmailFixture?.setScheduler(async () => {
    config.set("OPS_EMAIL_JOBS_ENABLED", true);
    try {
      await app.get(WeeklyDeliveryService).tick();
    } finally {
      config.set("OPS_EMAIL_JOBS_ENABLED", false);
    }
  });
  ledgerFixture?.setRuntimeWorkers(
    app
      .get(DiscoveryService)
      .getProviders()
      .filter((provider) => provider.metatype === PaymentLedgerSyncService).length,
  );
  const close = async () => {
    await app.close();
    await ledgerFixture?.close();
    await weeklyEmailFixture?.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
  process.stdout.write("Ops browser verification API ready on 4001.\n");
}

void start().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Verification server failed."}\n`,
  );
  process.exit(1);
});
