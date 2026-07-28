import { Module } from "@nestjs/common";
import { EngagementsController } from "./engagements.controller";
import { EngagementsService } from "./engagements.service";

@Module({
  controllers: [EngagementsController],
  providers: [EngagementsService],
})
export class EngagementsModule {}
