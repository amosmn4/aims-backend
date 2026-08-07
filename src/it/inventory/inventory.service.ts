import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateInventoryItemDto } from "./dto/create-inventory-item.dto";
import type { UpdateInventoryItemDto } from "./dto/update-inventory-item.dto";

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.inventoryItem.findMany({
      orderBy: { deviceName: "asc" },
      include: { office: { select: { id: true, name: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      include: { office: { select: { id: true, name: true } } },
    });
  }

  create(dto: CreateInventoryItemDto) {
    return this.prisma.inventoryItem.create({
      data: {
        assetTag: dto.assetTag,
        deviceName: dto.deviceName,
        description: dto.description,
        category: dto.category,
        status: dto.status,
        brand: dto.brand,
        model: dto.model,
        serialNumber: dto.serialNumber,
        assignedTo: dto.assignedTo,
        officeId: dto.officeId,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
        notes: dto.notes,
      },
      include: { office: { select: { id: true, name: true } } },
    });
  }

  update(id: string, dto: UpdateInventoryItemDto) {
    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        assetTag: dto.assetTag,
        deviceName: dto.deviceName,
        description: dto.description,
        category: dto.category,
        status: dto.status,
        brand: dto.brand,
        model: dto.model,
        serialNumber: dto.serialNumber,
        assignedTo: dto.assignedTo,
        officeId: dto.officeId,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
        notes: dto.notes,
      },
      include: { office: { select: { id: true, name: true } } },
    });
  }

  remove(id: string) {
    return this.prisma.inventoryItem.delete({ where: { id } });
  }
}
