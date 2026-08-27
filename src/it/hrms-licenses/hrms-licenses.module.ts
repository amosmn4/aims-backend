import { Module } from "@nestjs/common";
import { HrmsLicensesController } from "./hrms-licenses.controller";
import { HrmsLicensesService } from "./hrms-licenses.service";

@Module({
  controllers: [HrmsLicensesController],
  providers: [HrmsLicensesService],
})
export class HrmsLicensesModule {}
