import { Module } from "@nestjs/common";
import { FinanceUploadsController } from "./finance-uploads.controller";
import { FinanceUploadsService } from "./finance-uploads.service";

@Module({
  controllers: [FinanceUploadsController],
  providers: [FinanceUploadsService],
})
export class FinanceUploadsModule {}
