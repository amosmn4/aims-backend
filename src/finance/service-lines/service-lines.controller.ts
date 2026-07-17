import { Controller, Get } from "@nestjs/common";
import { ServiceLinesService } from "./service-lines.service";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("service-lines")
export class ServiceLinesController {
  constructor(private readonly serviceLinesService: ServiceLinesService) {}

  @Get()
  @Roles()
  findAll() {
    return this.serviceLinesService.findAll();
  }
}
