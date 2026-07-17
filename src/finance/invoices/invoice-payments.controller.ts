import { Controller, Get } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("invoice-payments")
@Roles("finance")
export class InvoicePaymentsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  findAll() {
    return this.invoicesService.findAllPayments();
  }
}
