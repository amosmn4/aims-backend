import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../auth/decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { InventoryService } from "../../it/inventory/inventory.service";
import {
  CreateInventoryItemDto,
  INVENTORY_CATEGORIES,
  INVENTORY_CONDITIONS,
  INVENTORY_STATUSES,
} from "../../it/inventory/dto/create-inventory-item.dto";
import { UpdateInventoryItemDto } from "../../it/inventory/dto/update-inventory-item.dto";
import { OpsAuthGuard } from "../ops-auth.guard";
import { OpsFeature, OpsModuleGuard } from "../ops-module.guard";
import { parse } from "../ops.schemas";

@Public()
@UseGuards(OpsAuthGuard, OpsModuleGuard)
@OpsFeature("inventory")
@Controller("ops/inventory")
export class OpsInventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    const dto = parse(
      z
        .object({
          q: z.string().trim().max(200).optional(),
          category: z.enum(INVENTORY_CATEGORIES).optional(),
          status: z.enum(INVENTORY_STATUSES).optional(),
          condition: z.enum(INVENTORY_CONDITIONS).optional(),
          officeId: z.string().uuid().optional(),
          page: z.coerce.number().int().min(1).default(1),
          departmentId: z.string().uuid().optional(),
          assignedUserId: z.string().uuid().optional(),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        })
        .strict(),
      query,
    );
    return this.inventory.findAll(dto, { page: dto.page, pageSize: dto.pageSize });
  }

  @Get("options")
  async options() {
    const [offices, departments, staff] = await Promise.all([
      this.prisma.office.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.opsStaff.findMany({
        where: { active: true, role: { not: "system_admin" }, user: { isActive: true } },
        select: { name: true, userId: true },
      }),
    ]);
    return {
      offices,
      departments,
      staff: staff.map((person) => ({ id: person.userId, name: person.name })),
      categories: INVENTORY_CATEGORIES,
      statuses: INVENTORY_STATUSES,
      conditions: INVENTORY_CONDITIONS,
    };
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.inventory.findOne(parse(z.string().uuid(), id));
  }

  @Post()
  create(@Body() body: CreateInventoryItemDto) {
    return this.inventory.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateInventoryItemDto) {
    return this.inventory.update(parse(z.string().uuid(), id), body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.inventory.remove(parse(z.string().uuid(), id));
  }
}
