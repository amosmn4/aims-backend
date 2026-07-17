import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { PayrollComplianceService } from "./payroll-compliance.service";
import { CreateComplianceRecordDto } from "./dto/create-compliance-record.dto";
import { MarkFiledDto } from "./dto/mark-filed.dto";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("payroll-compliance")
@Roles("finance")
export class PayrollComplianceController {
  constructor(private readonly payrollComplianceService: PayrollComplianceService) {}

  @Get()
  findAll() {
    return this.payrollComplianceService.findAll();
  }

  @Post()
  create(@Body() dto: CreateComplianceRecordDto) {
    return this.payrollComplianceService.create(dto);
  }

  @Patch(":id/mark-filed")
  markFiled(@Param("id") id: string, @Body() dto: MarkFiledDto) {
    return this.payrollComplianceService.markFiled(id, dto.filedDate);
  }
}
