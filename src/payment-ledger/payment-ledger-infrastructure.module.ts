import { Module } from "@nestjs/common";
import { PaymentGatewayService } from "./payment-gateway.service";
import { PaymentLedgerSyncService } from "./payment-ledger-sync.service";

@Module({
  providers: [PaymentGatewayService, PaymentLedgerSyncService],
  exports: [PaymentGatewayService, PaymentLedgerSyncService],
})
export class PaymentLedgerInfrastructureModule {}
