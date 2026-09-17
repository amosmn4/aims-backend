import { Body, Controller, Get, Param, Put, Post, Delete } from "@nestjs/common";
import { RecruitmentService } from "./recruitment.service";
import { UpsertRecruitmentFunnelDto } from "./dto/upsert-recruitment-funnel.dto";
import { CreatePlacementDto } from "./dto/placement.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("recruitment-funnels")
export class RecruitmentController {
  constructor(private readonly recruitmentService: RecruitmentService) {}

  @Get()
  @Roles()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.recruitmentService.findAll(user);
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

  @Get(":projectId/placements")
  @Roles()
  listPlacements(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recruitmentService.listPlacements(projectId, user);
  }

  @Post(":projectId/placements")
  @Roles("hr", "department_head", "account_manager")
  addPlacement(
    @Param("projectId") projectId: string,
    @Body() dto: CreatePlacementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recruitmentService.addPlacement(projectId, dto, user);
  }

  @Delete("placements/:placementId")
  @Roles("hr", "department_head", "account_manager")
  removePlacement(
    @Param("placementId") placementId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recruitmentService.removePlacement(placementId, user);
  }
}
