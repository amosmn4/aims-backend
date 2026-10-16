import { Module } from "@nestjs/common";
import { PaymentGatewayService } from "./payment-gateway.service";
import { PaymentLedgerAccessService } from "./payment-ledger-access.service";
import { PaymentLedgerController } from "./payment-ledger.controller";
import { PaymentLedgerService } from "./payment-ledger.service";
import { PaymentLedgerSyncService } from "./payment-ledger-sync.service";

@Module({
  controllers: [PaymentLedgerController],
  providers: [
    PaymentGatewayService,
    PaymentLedgerAccessService,
    PaymentLedgerService,
    PaymentLedgerSyncService,
  ],
})
export class PaymentLedgerModule {}
