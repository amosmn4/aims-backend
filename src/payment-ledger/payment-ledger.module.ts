import { Module } from "@nestjs/common";
import { PaymentLedgerAccessService } from "./payment-ledger-access.service";
import { PaymentLedgerController } from "./payment-ledger.controller";
import { PaymentLedgerService } from "./payment-ledger.service";
import { PaymentLedgerInfrastructureModule } from "./payment-ledger-infrastructure.module";

@Module({
  imports: [PaymentLedgerInfrastructureModule],
  controllers: [PaymentLedgerController],
  providers: [PaymentLedgerAccessService, PaymentLedgerService],
})
export class PaymentLedgerModule {}
