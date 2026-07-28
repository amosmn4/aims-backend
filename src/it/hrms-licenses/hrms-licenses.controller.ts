import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { HrmsLicensesService } from "./hrms-licenses.service";
import { CreateHrmsLicenseDto } from "./dto/create-hrms-license.dto";
import { UpdateHrmsLicenseDto } from "./dto/update-hrms-license.dto";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("hrms-licenses")
export class HrmsLicensesController {
  constructor(private readonly hrmsLicensesService: HrmsLicensesService) {}

  @Get()
  @Roles()
  findAll() {
    return this.hrmsLicensesService.findAll();
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.hrmsLicensesService.findOne(id);
  }

  @Post()
  @Roles("it")
  create(@Body() dto: CreateHrmsLicenseDto) {
    return this.hrmsLicensesService.create(dto);
  }

  @Patch(":id")
  @Roles("it")
  update(@Param("id") id: string, @Body() dto: UpdateHrmsLicenseDto) {
    return this.hrmsLicensesService.update(id, dto);
  }

  @Delete(":id")
  @Roles("it")
  remove(@Param("id") id: string) {
    return this.hrmsLicensesService.remove(id);
  }
}
