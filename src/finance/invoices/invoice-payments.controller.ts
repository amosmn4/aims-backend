import { Controller, Get } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import { Roles } from "../../auth/decorators/roles.decorator";
import {
  AlsoForDepartmentViewers,
  RequireCapability,
} from "../../auth/decorators/require-capability.decorator";

@Controller("invoice-payments")
@Roles()
@RequireCapability("raise_invoices")
export class InvoicePaymentsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @AlsoForDepartmentViewers("finance")
  findAll() {
    return this.invoicesService.findAllPayments();
  }
}
