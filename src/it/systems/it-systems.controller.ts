import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { ItSystemsService } from "./it-systems.service";
import { RecordUptimeDto } from "./dto/uptime.dto";
import { CreateItSystemDto } from "./dto/create-it-system.dto";
import { UpdateItSystemDto } from "./dto/update-it-system.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("it-systems")
export class ItSystemsController {
  constructor(private readonly itSystemsService: ItSystemsService) {}

  @Get()
  @Roles()
  findAll() {
    return this.itSystemsService.findAll();
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.itSystemsService.findOne(id);
  }

  @Post()
  @Roles("it")
  create(@Body() dto: CreateItSystemDto) {
    return this.itSystemsService.create(dto);
  }

  @Patch(":id")
  @Roles("it")
  update(@Param("id") id: string, @Body() dto: UpdateItSystemDto) {
    return this.itSystemsService.update(id, dto);
  }

  @Delete(":id")
  @Roles("it")
  remove(@Param("id") id: string) {
    return this.itSystemsService.remove(id);
  }

  @Get(":id/uptime")
  @Roles()
  listUptime(@Param("id") id: string) {
    return this.itSystemsService.listUptime(id);
  }

  @Put(":id/uptime")
  @Roles("it")
  recordUptime(
    @Param("id") id: string,
    @Body() dto: RecordUptimeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itSystemsService.recordUptime(id, dto, user.id);
  }

  @Delete("uptime/:recordId")
  @Roles("it")
  removeUptime(@Param("recordId") recordId: string) {
    return this.itSystemsService.removeUptime(recordId);
  }
}
