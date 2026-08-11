import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { TenderStage } from "@prisma/client";
import { TendersService } from "./tenders.service";
import { CreateTenderDto } from "./dto/create-tender.dto";
import { UpdateTenderDto } from "./dto/update-tender.dto";
import { UpdateTenderStageDto } from "./dto/update-tender-stage.dto";
import { CreateTenderResourceDto } from "./dto/create-tender-resource.dto";
import { UpdateTenderResourceDto } from "./dto/update-tender-resource.dto";
import { CreateTimeEntryDto } from "./dto/create-time-entry.dto";
import { ConvertToContractDto } from "./dto/convert-to-contract.dto";
import { ConvertTenderToProjectDto } from "./dto/convert-to-project.dto";
import { CreateTenderActivityDto } from "./dto/create-tender-activity.dto";
import { CreateTenderCostItemDto } from "./dto/create-tender-cost-item.dto";
import { UpdateTenderCostItemDto } from "./dto/update-tender-cost-item.dto";
import { CreateTenderBondDto } from "./dto/create-tender-bond.dto";
import { UpdateTenderBondDto } from "./dto/update-tender-bond.dto";
import { CreateTenderPricingItemDto } from "./dto/create-tender-pricing-item.dto";
import { UpdateTenderPricingItemDto } from "./dto/update-tender-pricing-item.dto";
import { CreateTenderRequirementDto } from "./dto/create-tender-requirement.dto";
import { UpdateTenderRequirementDto } from "./dto/update-tender-requirement.dto";
import { SaveAsTemplateDto } from "./dto/save-as-template.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { PaginationQueryDto } from "../../common/pagination";

const WRITE_ROLES = ["finance", "hr", "it", "marketing", "tender"] as const;

@Controller("tenders")
export class TendersController {
  constructor(private readonly tendersService: TendersService) {}

  // Open to any authenticated user, same "visibility across departments" convention as
  // Projects/Contracts — only mutation is department-gated.
  @Get()
  @Roles()
  findAll(
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("stage") stage?: TenderStage,
    @Query("clientId") clientId?: string,
    @Query("q") q?: string,
    @Query("deadlineFrom") deadlineFrom?: string,
    @Query("deadlineTo") deadlineTo?: string,
    @Query() pagination?: PaginationQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.tendersService.findAll(
      {
        departmentId,
        serviceLineId,
        stage,
        clientId,
        q,
        deadlineFrom,
        deadlineTo,
      },
      user!,
      pagination,
    );
  }

  @Get("pipeline-summary")
  @Roles()
  pipelineSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("deadlineFrom") deadlineFrom?: string,
    @Query("deadlineTo") deadlineTo?: string,
  ) {
    return this.tendersService.pipelineSummary(
      { departmentId, serviceLineId, deadlineFrom, deadlineTo },
      user,
    );
  }

  @Get("time-metrics")
  @Roles()
  timeMetrics(
    @CurrentUser() user: AuthenticatedUser,
    @Query("departmentId") departmentId?: string,
    @Query("serviceLineId") serviceLineId?: string,
    @Query("deadlineFrom") deadlineFrom?: string,
    @Query("deadlineTo") deadlineTo?: string,
  ) {
    return this.tendersService.timeMetrics(
      { departmentId, serviceLineId, deadlineFrom, deadlineTo },
      user,
    );
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.findOne(id, user);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateTenderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.create(dto, user);
  }

  @Patch(":id")
  @Roles(...WRITE_ROLES)
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTenderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.update(id, dto, user);
  }

  @Patch(":id/stage")
  @Roles(...WRITE_ROLES)
  updateStage(
    @Param("id") id: string,
    @Body() dto: UpdateTenderStageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.updateStage(id, dto, user);
  }

  @Delete(":id")
  @Roles("system_admin")
  remove(@Param("id") id: string) {
    return this.tendersService.remove(id);
  }

  @Post(":id/convert-to-contract")
  @Roles(...WRITE_ROLES)
  convertToContract(
    @Param("id") id: string,
    @Body() dto: ConvertToContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.convertToContract(id, dto, user);
  }

  @Post(":id/convert-to-project")
  @Roles(...WRITE_ROLES)
  convertToProject(
    @Param("id") id: string,
    @Body() dto: ConvertTenderToProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.convertToProject(id, dto, user);
  }

  @Get(":id/resources")
  @Roles()
  listResources(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.listResources(id, user);
  }

  @Post(":id/resources")
  @Roles(...WRITE_ROLES)
  createResource(
    @Param("id") id: string,
    @Body() dto: CreateTenderResourceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createResource(id, dto, user);
  }

  @Patch("resources/:resourceId")
  @Roles(...WRITE_ROLES)
  updateResource(
    @Param("resourceId") resourceId: string,
    @Body() dto: UpdateTenderResourceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.updateResource(resourceId, dto, user);
  }

  @Delete("resources/:resourceId")
  @Roles(...WRITE_ROLES)
  deleteResource(@Param("resourceId") resourceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deleteResource(resourceId, user);
  }

  @Get(":id/time-entries")
  @Roles()
  listTimeEntries(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.listTimeEntries(id, user);
  }

  @Post(":id/time-entries")
  @Roles()
  createTimeEntry(
    @Param("id") id: string,
    @Body() dto: CreateTimeEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createTimeEntry(id, dto, user);
  }

  @Delete("time-entries/:entryId")
  @Roles()
  deleteTimeEntry(@Param("entryId") entryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deleteTimeEntry(entryId, user);
  }

  @Get(":id/cost-summary")
  @Roles()
  getCostSummary(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.getCostSummary(id, user);
  }

  /* ---------- Cost items ---------- */

  @Get(":id/cost-items")
  @Roles()
  listCostItems(@Param("id") id: string) {
    return this.tendersService.listCostItems(id);
  }

  @Post(":id/cost-items")
  @Roles(...WRITE_ROLES)
  createCostItem(
    @Param("id") id: string,
    @Body() dto: CreateTenderCostItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createCostItem(id, dto, user);
  }

  @Patch("cost-items/:itemId")
  @Roles(...WRITE_ROLES)
  updateCostItem(
    @Param("itemId") itemId: string,
    @Body() dto: UpdateTenderCostItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.updateCostItem(itemId, dto, user);
  }

  @Delete("cost-items/:itemId")
  @Roles(...WRITE_ROLES)
  deleteCostItem(@Param("itemId") itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deleteCostItem(itemId, user);
  }

  /* ---------- Bonds ---------- */

  @Get(":id/bonds")
  @Roles()
  listBonds(@Param("id") id: string) {
    return this.tendersService.listBonds(id);
  }

  @Post(":id/bonds")
  @Roles(...WRITE_ROLES)
  createBond(
    @Param("id") id: string,
    @Body() dto: CreateTenderBondDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createBond(id, dto, user);
  }

  @Patch("bonds/:bondId")
  @Roles(...WRITE_ROLES)
  updateBond(
    @Param("bondId") bondId: string,
    @Body() dto: UpdateTenderBondDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.updateBond(bondId, dto, user);
  }

  @Delete("bonds/:bondId")
  @Roles(...WRITE_ROLES)
  deleteBond(@Param("bondId") bondId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deleteBond(bondId, user);
  }

  /* ---------- Pricing items ---------- */

  @Get(":id/pricing-items")
  @Roles()
  listPricingItems(@Param("id") id: string) {
    return this.tendersService.listPricingItems(id);
  }

  @Post(":id/pricing-items")
  @Roles(...WRITE_ROLES)
  createPricingItem(
    @Param("id") id: string,
    @Body() dto: CreateTenderPricingItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createPricingItem(id, dto, user);
  }

  @Patch("pricing-items/:itemId")
  @Roles(...WRITE_ROLES)
  updatePricingItem(
    @Param("itemId") itemId: string,
    @Body() dto: UpdateTenderPricingItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.updatePricingItem(itemId, dto, user);
  }

  @Delete("pricing-items/:itemId")
  @Roles(...WRITE_ROLES)
  deletePricingItem(@Param("itemId") itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deletePricingItem(itemId, user);
  }

  @Get(":id/financials-summary")
  @Roles()
  getFinancialsSummary(@Param("id") id: string) {
    return this.tendersService.getFinancialsSummary(id);
  }

  /* ---------- Requirements ---------- */

  @Get(":id/requirements")
  @Roles()
  listRequirements(@Param("id") id: string) {
    return this.tendersService.listRequirements(id);
  }

  @Post(":id/requirements")
  @Roles(...WRITE_ROLES)
  createRequirement(
    @Param("id") id: string,
    @Body() dto: CreateTenderRequirementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createRequirement(id, dto, user);
  }

  @Patch("requirements/:reqId")
  @Roles(...WRITE_ROLES)
  updateRequirement(
    @Param("reqId") reqId: string,
    @Body() dto: UpdateTenderRequirementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.updateRequirement(reqId, dto, user);
  }

  @Delete("requirements/:reqId")
  @Roles(...WRITE_ROLES)
  deleteRequirement(@Param("reqId") reqId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deleteRequirement(reqId, user);
  }

  @Post(":id/requirements/apply-template/:templateId")
  @Roles(...WRITE_ROLES)
  applyRequirementTemplate(
    @Param("id") id: string,
    @Param("templateId") templateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.applyRequirementTemplate(id, templateId, user);
  }

  @Post(":id/requirements/save-as-template")
  @Roles(...WRITE_ROLES)
  saveRequirementsAsTemplate(
    @Param("id") id: string,
    @Body() dto: SaveAsTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.saveRequirementsAsTemplate(id, dto, user);
  }

  @Get(":id/activities")
  @Roles()
  listActivities(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.listActivities(id, user);
  }

  @Post(":id/activities")
  @Roles(...WRITE_ROLES)
  createActivity(
    @Param("id") id: string,
    @Body() dto: CreateTenderActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.createActivity(id, dto, user);
  }

  @Delete("activities/:activityId")
  @Roles()
  deleteActivity(@Param("activityId") activityId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.deleteActivity(activityId, user);
  }
}
