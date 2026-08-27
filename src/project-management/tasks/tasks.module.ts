import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { DocumentsModule } from "../../documents/documents.module";
import { TimelineExtensionsModule } from "../timeline-extensions/timeline-extensions.module";
import { NotificationsModule } from "../../notifications/notifications.module";

@Module({
  imports: [DocumentsModule, TimelineExtensionsModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
