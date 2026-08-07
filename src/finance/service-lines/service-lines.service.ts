import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateServiceLineDto } from "./dto/create-service-line.dto";
import type { UpdateServiceLineDto } from "./dto/update-service-line.dto";

@Injectable()
export class ServiceLinesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.serviceLine.findMany({
      orderBy: { sortOrder: "asc" },
      include: { department: { select: { id: true, code: true, name: true } } },
    });
  }

  create(dto: CreateServiceLineDto) {
    return this.prisma.serviceLine.create({ data: dto });
  }

  update(id: string, dto: UpdateServiceLineDto) {
    return this.prisma.serviceLine.update({ where: { id }, data: dto });
  }

  // Every relation into ServiceLine (Invoice/Contract/Tender/ClientRequest) is onDelete: SetNull,
  // so unlike Department there's nothing to pre-check here — a delete is always safe.
  remove(id: string) {
    return this.prisma.serviceLine.delete({ where: { id } });
  }
}
