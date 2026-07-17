import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsSweepService } from "./notifications-sweep.service";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsSweepService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
