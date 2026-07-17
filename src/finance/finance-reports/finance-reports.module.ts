import { Module } from "@nestjs/common";
import { FinanceReportsController } from "./finance-reports.controller";
import { FinanceReportsService } from "./finance-reports.service";
import { DocumentsModule } from "../../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [FinanceReportsController],
  providers: [FinanceReportsService],
})
export class FinanceReportsModule {}
