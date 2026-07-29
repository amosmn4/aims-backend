import { Controller, Get, Query } from "@nestjs/common";
import { CalendarService } from "./calendar.service";
import { Roles } from "../auth/decorators/roles.decorator";

@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get("deadlines")
  @Roles()
  deadlines(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("departmentId") departmentId?: string,
  ) {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(start.getTime() + 90 * 86_400_000);
    return this.calendarService.listDeadlines(start, end, departmentId);
  }
}
