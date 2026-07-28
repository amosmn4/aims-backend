import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ItSystemsService } from "./it-systems.service";
import { CreateItSystemDto } from "./dto/create-it-system.dto";
import { UpdateItSystemDto } from "./dto/update-it-system.dto";
import { Roles } from "../../auth/decorators/roles.decorator";

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
}
