import { Module } from "@nestjs/common";
import { WaterController } from "./water.controller";
import { WaterService } from "./water.service";
import { WaterAiController } from "./water-ai.controller";
import { WaterAiService } from "./water-ai.service";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [AiModule],
  controllers: [WaterController, WaterAiController],
  providers: [WaterService, WaterAiService],
})
export class WaterModule {}
