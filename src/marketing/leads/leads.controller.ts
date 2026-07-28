import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { CreateLeadActivityDto } from "./dto/create-lead-activity.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @Roles()
  findAll(@Query("stage") stage?: string) {
    return this.leadsService.findAll({ stage });
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.leadsService.findOne(id);
  }

  @Post()
  @Roles("marketing")
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("marketing")
  update(@Param("id") id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Delete(":id")
  @Roles("marketing")
  remove(@Param("id") id: string) {
    return this.leadsService.remove(id);
  }

  @Get(":id/activities")
  @Roles()
  listActivities(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.listActivities(id, user);
  }

  @Post(":id/activities")
  @Roles("marketing")
  createActivity(
    @Param("id") id: string,
    @Body() dto: CreateLeadActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leadsService.createActivity(id, dto, user);
  }

  @Post(":id/convert-to-request")
  @Roles("marketing")
  convertToRequest(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.convertToRequest(id, user);
  }
}
