import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { OfficesService } from "./offices.service";
import { CreateOfficeDto } from "./dto/create-office.dto";
import { UpdateOfficeDto } from "./dto/update-office.dto";
import { Roles } from "../auth/decorators/roles.decorator";

@Controller("offices")
export class OfficesController {
  constructor(private readonly officesService: OfficesService) {}

  @Get()
  findAll() {
    return this.officesService.findAll();
  }

  @Post()
  @Roles("system_admin")
  create(@Body() dto: CreateOfficeDto) {
    return this.officesService.create(dto);
  }

  @Patch(":id")
  @Roles("system_admin")
  update(@Param("id") id: string, @Body() dto: UpdateOfficeDto) {
    return this.officesService.update(id, dto);
  }
}
