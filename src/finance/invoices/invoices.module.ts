import { Module } from "@nestjs/common";
import { InvoicesController } from "./invoices.controller";
import { InvoicePaymentsController } from "./invoice-payments.controller";
import { InvoicesService } from "./invoices.service";

@Module({
  controllers: [InvoicesController, InvoicePaymentsController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
