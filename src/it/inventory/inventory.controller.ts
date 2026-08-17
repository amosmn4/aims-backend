import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { InventoryCategory, InventoryCondition, InventoryStatus } from "@prisma/client";
import { InventoryService } from "./inventory.service";
import { CreateInventoryItemDto } from "./dto/create-inventory-item.dto";
import { UpdateInventoryItemDto } from "./dto/update-inventory-item.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { parsePaginationQuery } from "../../common/pagination";

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles()
  findAll(
    @Query("category") category?: InventoryCategory,
    @Query("status") status?: InventoryStatus,
    @Query("condition") condition?: InventoryCondition,
    @Query("officeId") officeId?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.inventoryService.findAll(
      { category, status, condition, officeId, q },
      parsePaginationQuery(page, pageSize),
    );
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
