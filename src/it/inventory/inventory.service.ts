import { Injectable } from "@nestjs/common";
import type { InventoryCategory, InventoryCondition, InventoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import type { CreateInventoryItemDto } from "./dto/create-inventory-item.dto";
import type { UpdateInventoryItemDto } from "./dto/update-inventory-item.dto";

export interface InventoryFilters {
  category?: InventoryCategory;
  status?: InventoryStatus;
  condition?: InventoryCondition;
  officeId?: string;
  q?: string;
}

const INCLUDE = {
  office: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, code: true } },
  assignedUser: { select: { id: true, fullName: true, email: true } },
} as const;

/** Straight-line value today from purchase cost, purchase date and useful life. */
function withValue<
  T extends { purchaseCost: unknown; purchaseDate: Date | null; usefulLifeMonths: number | null },
>(item: T) {
  const cost = item.purchaseCost == null ? null : Number(item.purchaseCost);
  if (cost == null || !item.purchaseDate || !item.usefulLifeMonths)
    return { ...item, currentValue: cost };
  const months = (Date.now() - item.purchaseDate.getTime()) / (30.4375 * 864e5);
  const currentValue = Math.max(0, Math.round(cost * (1 - months / item.usefulLifeMonths)));
  return { ...item, currentValue };
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filters: InventoryFilters = {}, pagination: PaginationQueryDto = {}) {
    return maybePaginate(
      this.prisma.inventoryItem,
      {
        where: {
          ...(filters.category && { category: filters.category }),
          ...(filters.status && { status: filters.status }),
          ...(filters.condition && { condition: filters.condition }),
          ...(filters.officeId && { officeId: filters.officeId }),
          ...(filters.q && {
            OR: [
              { deviceName: { contains: filters.q } },
              { assetTag: { contains: filters.q } },
              { serialNumber: { contains: filters.q } },
              { brand: { contains: filters.q } },
              { model: { contains: filters.q } },
              { assignedTo: { contains: filters.q } },
              { assignedUser: { fullName: { contains: filters.q } } },
            ],
          }),
        },
        orderBy: { deviceName: "asc" },
        include: INCLUDE,
      },
      pagination,
    ).then((result) =>
      Array.isArray(result)
        ? result.map(withValue)
        : { ...result, data: result.data.map(withValue) },
    );
  }

  findOne(id: string) {
    return this.prisma.inventoryItem
      .findUniqueOrThrow({ where: { id }, include: INCLUDE })
      .then(withValue);
  }

  create(dto: CreateInventoryItemDto) {
    return this.prisma.inventoryItem
      .create({
        data: {
          assetTag: dto.assetTag,
          deviceName: dto.deviceName,
          description: dto.description,
          category: dto.category,
          status: dto.status,
          condition: dto.condition,
          brand: dto.brand,
          model: dto.model,
          serialNumber: dto.serialNumber,
          assignedTo: dto.assignedTo,
          officeId: dto.officeId,
          purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
          warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
          notes: dto.notes,
          purchaseCost: dto.purchaseCost ?? undefined,
          usefulLifeMonths: dto.usefulLifeMonths ?? undefined,
          departmentId: dto.departmentId || undefined,
          assignedUserId: dto.assignedUserId || undefined,
        },
        include: INCLUDE,
      })
      .then(withValue);
  }

  update(id: string, dto: UpdateInventoryItemDto) {
    return this.prisma.inventoryItem
      .update({
        where: { id },
        data: {
          assetTag: dto.assetTag,
          deviceName: dto.deviceName,
          description: dto.description,
          category: dto.category,
          status: dto.status,
          condition: dto.condition,
          brand: dto.brand,
          model: dto.model,
          serialNumber: dto.serialNumber,
          assignedTo: dto.assignedTo,
          officeId: dto.officeId,
          purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
          warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
          notes: dto.notes,
          purchaseCost: dto.purchaseCost === undefined ? undefined : dto.purchaseCost,
          usefulLifeMonths: dto.usefulLifeMonths === undefined ? undefined : dto.usefulLifeMonths,
          departmentId: dto.departmentId === undefined ? undefined : dto.departmentId || null,
          assignedUserId: dto.assignedUserId === undefined ? undefined : dto.assignedUserId || null,
        },
        include: INCLUDE,
      })
      .then(withValue);
  }

  remove(id: string) {
    return this.prisma.inventoryItem.delete({ where: { id } });
  }
}
