import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { TenderRequirementTemplatesService } from "./tender-requirement-templates.service";
import { CreateRequirementTemplateDto } from "./dto/create-requirement-template.dto";
import { UpdateRequirementTemplateDto } from "./dto/update-requirement-template.dto";
import { CreateTemplateItemDto } from "./dto/create-template-item.dto";
import { UpdateTemplateItemDto } from "./dto/update-template-item.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

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
  @Roles()
  create(@Body() dto: CreateRequirementTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.create(dto, user);
  }

  @Patch(":id")
  @Roles()
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRequirementTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles()
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.remove(id, user);
  }

  @Post(":id/items")
  @Roles()
  addItem(
    @Param("id") id: string,
    @Body() dto: CreateTemplateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.addItem(id, dto, user);
  }

  @Patch("items/:itemId")
  @Roles()
  updateItem(
    @Param("itemId") itemId: string,
    @Body() dto: UpdateTemplateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.updateItem(itemId, dto, user);
  }

  @Delete("items/:itemId")
  @Roles()
  removeItem(@Param("itemId") itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.removeItem(itemId, user);
  }
}
