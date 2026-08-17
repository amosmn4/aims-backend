import { Module } from "@nestjs/common";
import { WaterController } from "./water.controller";
import { WaterService } from "./water.service";

@Module({
  controllers: [WaterController],
  providers: [WaterService],
})
export class WaterModule {}
