import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CalendarService } from "./calendar.service";
import { CreateCalendarEventDto, UpdateCalendarEventDto } from "./dto/calendar-event.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller("calendar")
@Roles()
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get("deadlines")
  deadlines(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("departmentId") departmentId?: string,
  ) {
    const [start, end] = this.range(from, to);
    return this.calendarService.listDeadlines(start, end, departmentId, user);
  }

  @Get("events")
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const [start, end] = this.range(from, to);
    return this.calendarService.listEvents(start, end, user);
  }

  @Post("events")
  createEvent(@Body() dto: CreateCalendarEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.calendarService.createEvent(dto, user);
  }

  @Patch("events/:id")
  updateEvent(
    @Param("id") id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendarService.updateEvent(id, dto, user);
  }

  @Delete("events/:id")
  removeEvent(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.calendarService.removeEvent(id, user);
  }

  private range(from?: string, to?: string): [Date, Date] {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(start.getTime() + 90 * 86_400_000);
    return [start, end];
  }
}
