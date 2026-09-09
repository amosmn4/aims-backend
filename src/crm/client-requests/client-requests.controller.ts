import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { ClientRequestSource, ClientRequestStage } from "@prisma/client";
import { ClientRequestsService } from "./client-requests.service";
import { CreateClientRequestDto } from "./dto/create-client-request.dto";
import { UpdateClientRequestDto } from "./dto/update-client-request.dto";
import { RouteClientRequestDto } from "./dto/route-client-request.dto";
import { UpdateClientRequestStageDto } from "./dto/update-client-request-stage.dto";
import { ConvertToProjectDto } from "./dto/convert-to-project.dto";
import { ConvertToContractDto } from "./dto/convert-to-contract.dto";
import { CreateActivityDto } from "./dto/create-activity.dto";
import { CreateAccessGrantDto } from "../../common/dto/create-access-grant.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { parsePaginationQuery } from "../../common/pagination";

// Any of the 5 delivery departments can be *routed* a request and then manage it from there.
// Operations owns intake — creating and routing a request is restricted to operations — but
// keeps write access here too so it can still update/annotate/convert requests it originated.
const DEPT_WRITE_ROLES = [
  "finance",
  "hr",
  "it",
  "marketing",
  "tender",
  "operations",
  "department_head",
  "account_manager",
] as const;

@Controller("client-requests")
export class ClientRequestsController {
  constructor(private readonly requestsService: ClientRequestsService) {}

  @Get()
  @Roles()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("stage") stage?: ClientRequestStage,
    @Query("source") source?: ClientRequestSource,
    @Query("clientId") clientId?: string,
    @Query("q") q?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.requestsService.findAll(
      { departmentId, serviceLineId, stage, source, clientId, q, dateFrom, dateTo },
      user,
      parsePaginationQuery(page, pageSize),
    );
  }

  @Get("pipeline-summary")
  @Roles()
  pipelineSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.requestsService.pipelineSummary(
      { departmentId, serviceLineId, dateFrom, dateTo },
      user,
    );
  }

  @Get("lost-breakdown")
  @Roles()
  lostBreakdown(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.requestsService.lostBreakdown(
      { departmentId, serviceLineId, dateFrom, dateTo },
      user,
    );
  }

  @Get("time-in-stage")
  @Roles()
  timeInStage(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.requestsService.timeInStage(
      { departmentId, serviceLineId, dateFrom, dateTo },
      user,
    );
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.findOne(id, user);
  }

  @Post()
  @Roles("operations")
  create(@Body() dto: CreateClientRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.create(dto, user);
  }

  // Open outer gate (any authenticated user) — the real check is inside update(), which also
  // honors an explicit access grant on this specific request, not just a department-code role.
  @Patch(":id")
  @Roles()
  update(
    @Param("id") id: string,
    @Body() dto: UpdateClientRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.update(id, dto, user);
  }

  @Patch(":id/route")
  @Roles("operations")
  route(
    @Param("id") id: string,
    @Body() dto: RouteClientRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.route(id, dto, user);
  }

  @Patch(":id/stage")
  @Roles(...DEPT_WRITE_ROLES)
  updateStage(
    @Param("id") id: string,
    @Body() dto: UpdateClientRequestStageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.updateStage(id, dto, user);
  }

  @Delete(":id")
  @Roles("system_admin")
  remove(@Param("id") id: string) {
    return this.requestsService.remove(id);
  }

  /* ---------- Access grants (share this request outside its own department) ---------- */

  @Get(":id/access-grants")
  @Roles()
  listAccessGrants(@Param("id") id: string) {
    return this.requestsService.listAccessGrants(id);
  }

  @Post(":id/access-grants")
  @Roles()
  createAccessGrant(
    @Param("id") id: string,
    @Body() dto: CreateAccessGrantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.createAccessGrant(id, dto, user);
  }

  @Delete(":id/access-grants/:grantId")
  @Roles()
  deleteAccessGrant(
    @Param("id") id: string,
    @Param("grantId") grantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.deleteAccessGrant(id, grantId, user);
  }

  @Post(":id/convert-to-project")
  @Roles(...DEPT_WRITE_ROLES)
  convertToProject(
    @Param("id") id: string,
    @Body() dto: ConvertToProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.convertToProject(id, dto, user);
  }

  @Post(":id/convert-to-contract")
  @Roles(...DEPT_WRITE_ROLES)
  convertToContract(
    @Param("id") id: string,
    @Body() dto: ConvertToContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.convertToContract(id, dto, user);
  }

  @Get(":id/activities")
  @Roles()
  listActivities(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.listActivities(id, user);
  }

  @Post(":id/activities")
  @Roles(...DEPT_WRITE_ROLES)
  createActivity(
    @Param("id") id: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestsService.createActivity(id, dto, user);
  }

  @Delete("activities/:activityId")
  @Roles()
  deleteActivity(@Param("activityId") activityId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.deleteActivity(activityId, user);
  }
}
