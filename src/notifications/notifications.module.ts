import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsSweepService } from "./notifications-sweep.service";
import { EmailService } from "./email/email.service";
import { NotificationsDigestService } from "./email/notifications-digest.service";
import { MessagingService } from "./channels/messaging.service";
import { NotificationChannelsService } from "./channels/notification-channels.service";

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsSweepService,
    EmailService,
    NotificationsDigestService,
    MessagingService,
    NotificationChannelsService,
  ],
  exports: [NotificationsService, EmailService, NotificationChannelsService],
})
export class NotificationsModule {}
