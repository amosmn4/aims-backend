import { Module } from "@nestjs/common";
import { ItSystemsController } from "./it-systems.controller";
import { ItSystemsService } from "./it-systems.service";

@Module({
  controllers: [ItSystemsController],
  providers: [ItSystemsService],
})
export class ItSystemsModule {}
