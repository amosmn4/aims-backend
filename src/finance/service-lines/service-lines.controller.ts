import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ServiceLinesService } from "./service-lines.service";
import { CreateServiceLineDto } from "./dto/create-service-line.dto";
import { UpdateServiceLineDto } from "./dto/update-service-line.dto";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("service-lines")
export class ServiceLinesController {
  constructor(private readonly serviceLinesService: ServiceLinesService) {}

  @Get()
  @Roles()
  findAll() {
    return this.serviceLinesService.findAll();
  }

  @Post()
  @Roles("system_admin")
  create(@Body() dto: CreateServiceLineDto) {
    return this.serviceLinesService.create(dto);
  }

  @Patch(":id")
  @Roles("system_admin")
  update(@Param("id") id: string, @Body() dto: UpdateServiceLineDto) {
    return this.serviceLinesService.update(id, dto);
  }

  @Delete(":id")
  @Roles("system_admin")
  remove(@Param("id") id: string) {
    return this.serviceLinesService.remove(id);
  }
}
