import { Body, Controller, Get, Param, Post, Query, Patch, Delete } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { UpdateInvoiceDto, VoidInvoiceDto } from "./dto/update-invoice.dto";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateFollowUpDto } from "./dto/create-follow-up.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import {
  AlsoForDepartmentViewers,
  RequireCapability,
} from "../../auth/decorators/require-capability.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { parsePaginationQuery } from "../../common/pagination";

@Controller("invoices")
@Roles()
@RequireCapability("raise_invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @AlsoForDepartmentViewers("finance")
  findAll(
    @Query("departmentId") departmentId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.invoicesService.findAll({ departmentId }, parsePaginationQuery(page, pageSize));
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.create(dto, user.id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, dto);
  }

  @Post(":id/void")
  void(@Param("id") id: string, @Body() dto: VoidInvoiceDto) {
    return this.invoicesService.void(id, dto.reason);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.invoicesService.remove(id);
  }

  @Delete("payments/:paymentId")
  removePayment(@Param("paymentId") paymentId: string) {
    return this.invoicesService.removePayment(paymentId);
  }

  @Post(":id/payments")
  recordPayment(@Param("id") id: string, @Body() dto: CreatePaymentDto) {
    return this.invoicesService.recordPayment(id, dto);
  }

  @Get(":id/follow-ups")
  @AlsoForDepartmentViewers("finance")
  findFollowUps(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findFollowUps(id, user);
  }

  @Delete("follow-ups/:followUpId")
  removeFollowUp(@Param("followUpId") followUpId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.removeFollowUp(followUpId, user);
  }

  @Post(":id/follow-ups")
  createFollowUp(
    @Param("id") id: string,
    @Body() dto: CreateFollowUpDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.createFollowUp(id, dto, user);
  }
}
