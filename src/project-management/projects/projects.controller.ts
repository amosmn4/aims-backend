import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { ProjectStatus } from "@prisma/client";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { CreateMilestoneDto } from "./dto/create-milestone.dto";
import { UpdateMilestoneDto } from "./dto/update-milestone.dto";
import { CreateProjectActivityDto } from "./dto/create-project-activity.dto";
import { CreateCostItemDto } from "./dto/create-cost-item.dto";
import { UpdateCostItemDto } from "./dto/update-cost-item.dto";
import { CreateTeamMemberDto } from "./dto/create-team-member.dto";
import { UpdateTeamMemberDto } from "./dto/update-team-member.dto";
import { CreateRaciEntryDto } from "./dto/create-raci-entry.dto";
import { UpdateRaciEntryDto } from "./dto/update-raci-entry.dto";
import { CreateRaidEntryDto } from "./dto/create-raid-entry.dto";
import { UpdateRaidEntryDto } from "./dto/update-raid-entry.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { PaginationQueryDto } from "../../common/pagination";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // Open to any authenticated user — visibility across departments is expected;
  // create/update/delete are what's actually gated (see ProjectsService).
  @Get()
  @Roles()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("status") status?: ProjectStatus,
    @Query("clientId") clientId?: string,
    @Query("sharedWithMe") sharedWithMe?: string,
    @Query() pagination?: PaginationQueryDto,
  ) {
    return this.projectsService.findAll(
      { departmentId, status, clientId, sharedWithMe: sharedWithMe === "true" },
      pagination,
      user,
    );
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findOne(id, user);
  }

  @Post()
  @Roles("finance", "hr", "it", "marketing", "tender")
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("finance", "hr", "it", "marketing", "tender")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.update(id, dto, user);
  }

  // Department-scoped, same as update()/create() above — system_admin/ceo can delete any
  // project, a department's own staff can delete their own department's projects, enforced in
  // the service via assertDepartmentAccess (not just the role list here, since that alone
  // can't tell "your department" apart from "any department with a matching role").
  @Delete(":id")
  @Roles("finance", "hr", "it", "marketing", "tender")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.remove(id, user);
  }

  @Get(":id/financials")
  @Roles()
  getFinancials(@Param("id") id: string) {
    return this.projectsService.getFinancials(id);
  }

  @Get(":id/milestones")
  @Roles()
  listMilestones(@Param("id") id: string) {
    return this.projectsService.listMilestones(id);
  }

  @Post(":id/milestones")
  @Roles("finance", "hr", "it", "marketing", "tender")
  createMilestone(
    @Param("id") id: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createMilestone(id, dto, user);
  }

  @Patch("milestones/:milestoneId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  updateMilestone(
    @Param("milestoneId") milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateMilestone(milestoneId, dto, user);
  }

  @Delete("milestones/:milestoneId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  removeMilestone(
    @Param("milestoneId") milestoneId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.removeMilestone(milestoneId, user);
  }

  @Get(":id/activities")
  @Roles()
  listActivities(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listActivities(id, user);
  }

  @Post(":id/activities")
  @Roles("finance", "hr", "it", "marketing", "tender")
  createActivity(
    @Param("id") id: string,
    @Body() dto: CreateProjectActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createActivity(id, dto, user);
  }

  @Delete("activities/:activityId")
  @Roles()
  deleteActivity(@Param("activityId") activityId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.deleteActivity(activityId, user);
  }

  /* ---------- Cost items ---------- */

  @Get(":id/cost-items")
  @Roles()
  listCostItems(@Param("id") id: string) {
    return this.projectsService.listCostItems(id);
  }

  @Post(":id/cost-items")
  @Roles("finance", "hr", "it", "marketing", "tender")
  createCostItem(
    @Param("id") id: string,
    @Body() dto: CreateCostItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createCostItem(id, dto, user);
  }

  @Patch("cost-items/:itemId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  updateCostItem(
    @Param("itemId") itemId: string,
    @Body() dto: UpdateCostItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateCostItem(itemId, dto, user);
  }

  @Delete("cost-items/:itemId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  deleteCostItem(@Param("itemId") itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.deleteCostItem(itemId, user);
  }

  /* ---------- Team & Resources ---------- */

  @Get(":id/team")
  @Roles()
  listTeam(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listTeam(id, user);
  }

  @Post(":id/team")
  @Roles("finance", "hr", "it", "marketing", "tender")
  createTeamMember(
    @Param("id") id: string,
    @Body() dto: CreateTeamMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createTeamMember(id, dto, user);
  }

  @Patch("team/:memberId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  updateTeamMember(
    @Param("memberId") memberId: string,
    @Body() dto: UpdateTeamMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateTeamMember(memberId, dto, user);
  }

  @Delete("team/:memberId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  deleteTeamMember(@Param("memberId") memberId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.deleteTeamMember(memberId, user);
  }

  /* ---------- RACI matrix ---------- */

  @Get(":id/raci")
  @Roles()
  listRaci(@Param("id") id: string) {
    return this.projectsService.listRaci(id);
  }

  @Post(":id/raci")
  @Roles("finance", "hr", "it", "marketing", "tender")
  createRaciEntry(
    @Param("id") id: string,
    @Body() dto: CreateRaciEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createRaciEntry(id, dto, user);
  }

  @Patch("raci/:entryId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  updateRaciEntry(
    @Param("entryId") entryId: string,
    @Body() dto: UpdateRaciEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateRaciEntry(entryId, dto, user);
  }

  @Delete("raci/:entryId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  deleteRaciEntry(@Param("entryId") entryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.deleteRaciEntry(entryId, user);
  }

  /* ---------- RAID log ---------- */

  @Get(":id/raid")
  @Roles()
  listRaid(@Param("id") id: string) {
    return this.projectsService.listRaid(id);
  }

  @Post(":id/raid")
  @Roles("finance", "hr", "it", "marketing", "tender")
  createRaidEntry(
    @Param("id") id: string,
    @Body() dto: CreateRaidEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createRaidEntry(id, dto, user);
  }

  @Patch("raid/:entryId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  updateRaidEntry(
    @Param("entryId") entryId: string,
    @Body() dto: UpdateRaidEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateRaidEntry(entryId, dto, user);
  }

  @Delete("raid/:entryId")
  @Roles("finance", "hr", "it", "marketing", "tender")
  deleteRaidEntry(@Param("entryId") entryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.deleteRaidEntry(entryId, user);
  }
}
