import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsSweepService } from "./notifications-sweep.service";
import { EmailService } from "./email/email.service";
import { NotificationsDigestService } from "./email/notifications-digest.service";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsSweepService, EmailService, NotificationsDigestService],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
