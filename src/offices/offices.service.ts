import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateOfficeDto } from "./dto/create-office.dto";
import type { UpdateOfficeDto } from "./dto/update-office.dto";

@Injectable()
export class OfficesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.office.findMany({ orderBy: { name: "asc" } });
  }

  async create(dto: CreateOfficeDto) {
    const office = await this.prisma.office.create({ data: dto });
    if (dto.isHq)
      await this.prisma.office.updateMany({
        where: { id: { not: office.id } },
        data: { isHq: false },
      });
    return office;
  }

  async update(id: string, dto: UpdateOfficeDto) {
    const office = await this.prisma.office.update({ where: { id }, data: dto });
    if (dto.isHq)
      await this.prisma.office.updateMany({ where: { id: { not: id } }, data: { isHq: false } });
    return office;
  }
}
