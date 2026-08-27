import { Module } from "@nestjs/common";
import { TimelineExtensionsController } from "./timeline-extensions.controller";
import { TimelineExtensionsService } from "./timeline-extensions.service";

@Module({
  controllers: [TimelineExtensionsController],
  providers: [TimelineExtensionsService],
  exports: [TimelineExtensionsService],
})
export class TimelineExtensionsModule {}
