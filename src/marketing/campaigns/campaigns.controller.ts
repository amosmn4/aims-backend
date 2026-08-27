import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { UpdateCampaignDto } from "./dto/update-campaign.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @Roles()
  findAll() {
    return this.campaignsService.findAll();
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.campaignsService.findOne(id);
  }

  @Get(":id/roi")
  @Roles()
  roi(@Param("id") id: string) {
    return this.campaignsService.roi(id);
  }

  @Post()
  @Roles("marketing")
  create(@Body() dto: CreateCampaignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("marketing")
  update(@Param("id") id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(id, dto);
  }

  @Delete(":id")
  @Roles("marketing")
  remove(@Param("id") id: string) {
    return this.campaignsService.remove(id);
  }
}
