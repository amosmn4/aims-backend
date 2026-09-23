import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsSweepService } from "./notifications-sweep.service";
import { NotificationsDigestService } from "./email/notifications-digest.service";
import { CreateReminderDto } from "./dto/create-reminder.dto";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";
import { MuteAllDto, SetChannelPreferenceDto } from "./dto/set-channel-preference.dto";
import { NotificationChannelsService } from "./channels/notification-channels.service";
import { Roles } from "../auth/decorators/roles.decorator";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly sweep: NotificationsSweepService,
    private readonly digest: NotificationsDigestService,
    private readonly channels: NotificationChannelsService,
  ) {}

  @Get("channels")
  @Roles()
  getChannels(@CurrentUser() user: AuthenticatedUser) {
    return this.channels.forUser(user.id);
  }

  @Post("channels/test-sms")
  @Roles()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  testSms(@CurrentUser() user: AuthenticatedUser) {
    return this.channels.testSms(user.id);
  }

  @Put("channels")
  @Roles()
  setChannel(@Body() dto: SetChannelPreferenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.channels.setForUser(user.id, dto);
  }

  @Put("channels/mute-all")
  @Roles()
  muteAll(@Body() dto: MuteAllDto, @CurrentUser() user: AuthenticatedUser) {
    return this.channels.muteAll(user.id, dto.mutedUntil);
  }

  @Get()
  @Roles()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.findForUser(user.id);
  }

  @Get("unread-count")
  @Roles()
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Get("preferences")
  @Roles()
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Put("preferences")
  @Roles()
  updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.updatePreferences(user.id, dto);
  }

  @Post()
  @Roles()
  createReminder(@Body() dto: CreateReminderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.createReminder(dto, user);
  }

  @Patch(":id/read")
  @Roles()
  markRead(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(id, user);
  }

  @Patch("read-all")
  @Roles()
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user);
  }

  @Delete(":id")
  @Roles()
  dismiss(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.dismiss(id, user);
  }

  // Manual trigger for the sweep, gated to system_admin — useful for demos/testing without
  // waiting for the top of the hour; the real trigger is the @Cron schedule.
  @Post("sweep-now")
  @Roles("system_admin")
  async sweepNow() {
    await this.sweep.runSweep();
    return { success: true };
  }

  // Manual trigger for the email digest, gated to system_admin — same shape as sweep-now.
  // Returns a clean "not configured" result rather than a 500 when SMTP isn't set up.
  @Post("digest-now")
  @Roles("system_admin")
  digestNow() {
    return this.digest.runDigest();
  }
}
