import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { assertModuleWrite } from "../../common/module-access";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateRequirementTemplateDto } from "./dto/create-requirement-template.dto";
import type { UpdateRequirementTemplateDto } from "./dto/update-requirement-template.dto";
import type { CreateTemplateItemDto } from "./dto/create-template-item.dto";
import type { UpdateTemplateItemDto } from "./dto/update-template-item.dto";

// Global, reusable requirement checklists — managed only by the Tender module, like tenders themselves.
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

  private assertManage(user: AuthenticatedUser) {
    return assertModuleWrite(
      "tender",
      user,
      this.prisma,
      "Only the Tender team can manage templates",
    );
  }

  async create(dto: CreateRequirementTemplateDto, user: AuthenticatedUser) {
    await this.assertManage(user);
    return this.prisma.tenderRequirementTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        createdBy: user.id,
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

  async update(id: string, dto: UpdateRequirementTemplateDto, user: AuthenticatedUser) {
    await this.assertManage(user);
    return this.prisma.tenderRequirementTemplate.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.assertManage(user);
    return this.prisma.tenderRequirementTemplate.delete({ where: { id } });
  }

  async addItem(templateId: string, dto: CreateTemplateItemDto, user: AuthenticatedUser) {
    await this.assertManage(user);
    const count = await this.prisma.tenderRequirementTemplateItem.count({ where: { templateId } });
    return this.prisma.tenderRequirementTemplateItem.create({
      data: { templateId, ...dto, sortOrder: count },
    });
  }

  async updateItem(itemId: string, dto: UpdateTemplateItemDto, user: AuthenticatedUser) {
    await this.assertManage(user);
    return this.prisma.tenderRequirementTemplateItem.update({ where: { id: itemId }, data: dto });
  }

  async removeItem(itemId: string, user: AuthenticatedUser) {
    await this.assertManage(user);
    return this.prisma.tenderRequirementTemplateItem.delete({ where: { id: itemId } });
  }
}
