import { Module } from "@nestjs/common";
import { PayrollComplianceController } from "./payroll-compliance.controller";
import { PayrollComplianceService } from "./payroll-compliance.service";

@Module({
  controllers: [PayrollComplianceController],
  providers: [PayrollComplianceService],
})
export class PayrollComplianceModule {}
