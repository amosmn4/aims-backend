import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateRequirementTemplateDto } from "./dto/create-requirement-template.dto";
import type { UpdateRequirementTemplateDto } from "./dto/update-requirement-template.dto";
import type { CreateTemplateItemDto } from "./dto/create-template-item.dto";
import type { UpdateTemplateItemDto } from "./dto/update-template-item.dto";

// Global, reusable catalog — not tender-scoped. Any of the operating departments can create/
// manage templates (organic, team-built checklists), matching the same WRITE_ROLES convention
// tenders themselves use, enforced at the controller.
@Injectable()
export class TenderRequirementTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.tenderRequirementTemplate.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { name: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.tenderRequirementTemplate.findUniqueOrThrow({
      where: { id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  create(dto: CreateRequirementTemplateDto, userId: string) {
    return this.prisma.tenderRequirementTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        createdBy: userId,
        items: dto.items
          ? {
              create: dto.items.map((item, i) => ({
                title: item.title,
                category: item.category,
                sortOrder: i,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
  }

  update(id: string, dto: UpdateRequirementTemplateDto) {
    return this.prisma.tenderRequirementTemplate.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.tenderRequirementTemplate.delete({ where: { id } });
  }

  async addItem(templateId: string, dto: CreateTemplateItemDto) {
    const count = await this.prisma.tenderRequirementTemplateItem.count({ where: { templateId } });
    return this.prisma.tenderRequirementTemplateItem.create({
      data: { templateId, ...dto, sortOrder: count },
    });
  }

  updateItem(itemId: string, dto: UpdateTemplateItemDto) {
    return this.prisma.tenderRequirementTemplateItem.update({ where: { id: itemId }, data: dto });
  }

  removeItem(itemId: string) {
    return this.prisma.tenderRequirementTemplateItem.delete({ where: { id: itemId } });
  }
}
