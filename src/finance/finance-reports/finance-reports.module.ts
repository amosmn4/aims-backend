import { Module } from "@nestjs/common";
import { FinanceReportsController } from "./finance-reports.controller";
import { FinanceReportsService } from "./finance-reports.service";
import { DocumentsModule } from "../../documents/documents.module";
import { ReportsModule } from "../../reports/reports.module";

@Module({
  imports: [DocumentsModule, ReportsModule],
  controllers: [FinanceReportsController],
  providers: [FinanceReportsService],
})
export class FinanceReportsModule {}
