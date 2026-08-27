import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { TenderRequirementTemplatesService } from "./tender-requirement-templates.service";
import { CreateRequirementTemplateDto } from "./dto/create-requirement-template.dto";
import { UpdateRequirementTemplateDto } from "./dto/update-requirement-template.dto";
import { CreateTemplateItemDto } from "./dto/create-template-item.dto";
import { UpdateTemplateItemDto } from "./dto/update-template-item.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

const WRITE_ROLES = ["finance", "hr", "it", "marketing", "tender"] as const;

@Controller("tender-requirement-templates")
export class TenderRequirementTemplatesController {
  constructor(private readonly templatesService: TenderRequirementTemplatesService) {}

  @Get()
  @Roles()
  findAll() {
    return this.templatesService.findAll();
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.templatesService.findOne(id);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateRequirementTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.create(dto, user.id);
  }

  @Patch(":id")
  @Roles(...WRITE_ROLES)
  update(@Param("id") id: string, @Body() dto: UpdateRequirementTemplateDto) {
    return this.templatesService.update(id, dto);
  }

  @Delete(":id")
  @Roles(...WRITE_ROLES)
  remove(@Param("id") id: string) {
    return this.templatesService.remove(id);
  }

  @Post(":id/items")
  @Roles(...WRITE_ROLES)
  addItem(@Param("id") id: string, @Body() dto: CreateTemplateItemDto) {
    return this.templatesService.addItem(id, dto);
  }

  @Patch("items/:itemId")
  @Roles(...WRITE_ROLES)
  updateItem(@Param("itemId") itemId: string, @Body() dto: UpdateTemplateItemDto) {
    return this.templatesService.updateItem(itemId, dto);
  }

  @Delete("items/:itemId")
  @Roles(...WRITE_ROLES)
  removeItem(@Param("itemId") itemId: string) {
    return this.templatesService.removeItem(itemId);
  }
}
