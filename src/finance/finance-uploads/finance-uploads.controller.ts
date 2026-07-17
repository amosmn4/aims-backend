import { Body, Controller, Post } from "@nestjs/common";
import { FinanceUploadsService } from "./finance-uploads.service";
import { ImportInvoicesDto } from "./dto/import-invoices.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("finance-uploads")
@Roles("finance")
export class FinanceUploadsController {
  constructor(private readonly financeUploadsService: FinanceUploadsService) {}

  @Post("invoices")
  importInvoices(@Body() dto: ImportInvoicesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financeUploadsService.importInvoices(dto, user.id);
  }
}
