import { Global, Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ThreadsService } from "./threads.service";

@Global()
@Module({
  imports: [NotificationsModule],
  providers: [ThreadsService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
