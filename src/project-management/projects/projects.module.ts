import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { DocumentsModule } from "../../documents/documents.module";
import { TimelineExtensionsModule } from "../timeline-extensions/timeline-extensions.module";
import { NotificationsModule } from "../../notifications/notifications.module";

@Module({
  imports: [DocumentsModule, TimelineExtensionsModule, NotificationsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
