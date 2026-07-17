import { Module } from "@nestjs/common";
import { ServiceLinesController } from "./service-lines.controller";
import { ServiceLinesService } from "./service-lines.service";

@Module({
  controllers: [ServiceLinesController],
  providers: [ServiceLinesService],
})
export class ServiceLinesModule {}
