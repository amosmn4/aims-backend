import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { RecruitmentService } from "./recruitment.service";
import { UpsertRecruitmentFunnelDto } from "./dto/upsert-recruitment-funnel.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("recruitment-funnels")
export class RecruitmentController {
  constructor(private readonly recruitmentService: RecruitmentService) {}

  @Get()
  @Roles()
  findAll() {
    return this.recruitmentService.findAll();
  }

  @Get(":projectId")
  @Roles()
  findOne(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recruitmentService.findOne(projectId, user);
  }

  @Put(":projectId")
  @Roles("hr", "department_head", "account_manager")
  upsert(
    @Param("projectId") projectId: string,
    @Body() dto: UpsertRecruitmentFunnelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recruitmentService.upsert(projectId, dto, user);
  }
}
