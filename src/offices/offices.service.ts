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

  create(dto: CreateOfficeDto) {
    return this.prisma.office.create({ data: dto });
  }

  update(id: string, dto: UpdateOfficeDto) {
    return this.prisma.office.update({ where: { id }, data: dto });
  }
}
