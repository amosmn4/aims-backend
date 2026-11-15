import { PaymentLedgerInfrastructureModule } from "../payment-ledger/payment-ledger-infrastructure.module";
import { PaymentLedgerService } from "../payment-ledger/payment-ledger.service";
import { PaymentLedgerAccessService } from "../payment-ledger/payment-ledger-access.service";
import { OpsLedgerAccessService } from "./modules/ops-ledger-access.service";
import { OpsLedgerController } from "./modules/ops-ledger.controller";
import { OpsWaterController } from "./modules/ops-water.controller";
import { OpsWaterImportController } from "./modules/ops-water-import.controller";
import { OpsWaterExpensesController } from "./modules/ops-water-expenses.controller";
import { OpsWaterAiController } from "./modules/ops-water-ai.controller";
import { OpsBlogController } from "./modules/ops-blog.controller";
import { OpsWaterAssistantController } from "./modules/ops-water-assistant.controller";
import { OpsTendersController } from "./modules/ops-tenders.controller";
import { OpsTendersService } from "./modules/ops-tenders.service";
import { opsFeatureProviders } from "./modules/ops-feature.providers";
import { OpsModuleGuard } from "./ops-module.guard";
import { Module } from "@nestjs/common";
import { WeeklyController } from "./weekly/weekly.controller";
import { OpsHealthController } from "./ops-health.controller";
import { WeeklyService } from "./weekly/weekly.service";
import { WeeklyClock } from "./weekly/weekly-clock";
import { WeeklyDeliveryService } from "./weekly/weekly-delivery.service";
import { JwtModule } from "@nestjs/jwt";
import { StorageModule } from "../storage/storage.module";
import { EmailService } from "../notifications/email/email.service";
import { OpsAuthController } from "./ops-auth.controller";
import { OpsAuthGuard } from "./ops-auth.guard";
import { OpsAuthService } from "./ops-auth.service";
import { OpsController } from "./ops.controller";
import { OpsRepository } from "./ops.repository";
import { OpsService } from "./ops.service";
import { TendersModule } from "../crm/tenders/tenders.module";
import { WaterModule } from "../water/water.module";

@Module({
  imports: [
    JwtModule.register({}),
    StorageModule,
    PaymentLedgerInfrastructureModule,
    TendersModule,
    WaterModule,
  ],
  controllers: [
    OpsHealthController,
    WeeklyController,
    OpsLedgerController,
    OpsAuthController,
    OpsController,
    OpsWaterController,
    OpsWaterImportController,
    OpsWaterExpensesController,
    OpsWaterAiController,
    OpsBlogController,
    OpsWaterAssistantController,
    OpsTendersController,
  ],
  providers: [
    WeeklyService,
    WeeklyClock,
    WeeklyDeliveryService,
    ...opsFeatureProviders,
    PaymentLedgerService,
    { provide: PaymentLedgerAccessService, useClass: OpsLedgerAccessService },
    OpsModuleGuard,
    OpsAuthService,
    OpsAuthGuard,
    OpsRepository,
    OpsService,
    OpsTendersService,
    EmailService,
  ],
})
export class OpsModule {}
