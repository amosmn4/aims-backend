import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { InventoryCategory, InventoryStatus } from "@prisma/client";
import { InventoryService } from "./inventory.service";
import { CreateInventoryItemDto } from "./dto/create-inventory-item.dto";
import { UpdateInventoryItemDto } from "./dto/update-inventory-item.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PaginationQueryDto } from "../../common/pagination";

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles()
  findAll(
    @Query("category") category?: InventoryCategory,
    @Query("status") status?: InventoryStatus,
    @Query("officeId") officeId?: string,
    @Query("q") q?: string,
    @Query() pagination?: PaginationQueryDto,
  ) {
    return this.inventoryService.findAll({ category, status, officeId, q }, pagination);
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.inventoryService.findOne(id);
  }

  @Post()
  @Roles("it")
  create(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.create(dto);
  }

  @Patch(":id")
  @Roles("it")
  update(@Param("id") id: string, @Body() dto: UpdateInventoryItemDto) {
    return this.inventoryService.update(id, dto);
  }

  @Delete(":id")
  @Roles("it")
  remove(@Param("id") id: string) {
    return this.inventoryService.remove(id);
  }
}
