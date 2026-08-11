import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateFollowUpDto } from "./dto/create-follow-up.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { PaginationQueryDto } from "../../common/pagination";

@Controller("invoices")
@Roles("finance")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  findAll(@Query("departmentId") departmentId?: string, @Query() pagination?: PaginationQueryDto) {
    return this.invoicesService.findAll({ departmentId }, pagination);
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.create(dto, user.id);
  }

  @Post(":id/payments")
  recordPayment(@Param("id") id: string, @Body() dto: CreatePaymentDto) {
    return this.invoicesService.recordPayment(id, dto);
  }

  @Get(":id/follow-ups")
  findFollowUps(@Param("id") id: string) {
    return this.invoicesService.findFollowUps(id);
  }

  @Post(":id/follow-ups")
  createFollowUp(
    @Param("id") id: string,
    @Body() dto: CreateFollowUpDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.createFollowUp(id, dto, user.id);
  }
}
