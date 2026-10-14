import { Module } from "@nestjs/common";
import { WaterController } from "./water.controller";
import { WaterService } from "./water.service";
import { WaterAiController } from "./water-ai.controller";
import { WaterAiService } from "./water-ai.service";
import { AiModule } from "../ai/ai.module";
import { WaterExpensesModule } from "./water-expenses.module";

@Module({
  imports: [AiModule, WaterExpensesModule],
  controllers: [WaterController, WaterAiController],
  providers: [WaterService, WaterAiService],
  exports: [WaterService],
})
export class WaterModule {}
