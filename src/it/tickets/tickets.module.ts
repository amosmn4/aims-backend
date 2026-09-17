import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller";
import { TicketsService } from "./tickets.service";
import { NotificationsModule } from "../../notifications/notifications.module";

@Module({
  controllers: [TicketsController],
  imports: [NotificationsModule],
  providers: [TicketsService],
})
export class TicketsModule {}
