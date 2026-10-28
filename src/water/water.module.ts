import { Module } from "@nestjs/common";
import { WaterController } from "./water.controller";
import { WaterService } from "./water.service";
import { WaterAiController } from "./water-ai.controller";
import { WaterAiService } from "./water-ai.service";
import { AiModule } from "../ai/ai.module";
import { WaterExpensesModule } from "./water-expenses.module";
import { WaterReadingReviewService } from "./water-reading-review.service";
import { StorageModule } from "../storage/storage.module";
import { WaterFileExtractionService } from "./water-file-extraction.service";
import { WaterImportService } from "./water-import.service";
import { WaterImportController } from "./water-import.controller";

@Module({
  imports: [AiModule, WaterExpensesModule, StorageModule],
  controllers: [WaterController, WaterAiController, WaterImportController],
  providers: [
    WaterService,
    WaterAiService,
    WaterReadingReviewService,
    WaterFileExtractionService,
    WaterImportService,
  ],
  exports: [WaterService],
})
export class WaterModule {}
