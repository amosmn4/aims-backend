import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateItSystemDto } from "./dto/create-it-system.dto";
import type { UpdateItSystemDto } from "./dto/update-it-system.dto";

import type { RecordUptimeDto } from "./dto/uptime.dto";

@Injectable()
export class ItSystemsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.itSystem.findMany({ orderBy: { name: "asc" } });
  }

  findOne(id: string) {
    return this.prisma.itSystem.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreateItSystemDto) {
    return this.prisma.itSystem.create({
      data: {
        name: dto.name,
        type: dto.type,
        status: dto.status,
        owner: dto.owner,
        notes: dto.notes,
      },
    });
  }

  update(id: string, dto: UpdateItSystemDto) {
    return this.prisma.itSystem.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        status: dto.status,
        owner: dto.owner,
        notes: dto.notes,
      },
    });
  }

  remove(id: string) {
    return this.prisma.itSystem.delete({ where: { id } });
  }

  listUptime(systemId: string) {
    return this.prisma.systemUptimeRecord.findMany({
      where: { systemId },
      orderBy: { month: "desc" },
      take: 24,
    });
  }

  async recordUptime(systemId: string, dto: RecordUptimeDto, userId: string) {
    await this.prisma.itSystem.findUniqueOrThrow({ where: { id: systemId } });
    const month = new Date(`${dto.month}-01T00:00:00Z`);
    return this.prisma.systemUptimeRecord.upsert({
      where: { systemId_month: { systemId, month } },
      create: {
        systemId,
        month,
        uptimePercent: dto.uptimePercent,
        notes: dto.notes,
        createdBy: userId,
      },
      update: { uptimePercent: dto.uptimePercent, notes: dto.notes },
    });
  }

  async removeUptime(recordId: string) {
    await this.prisma.systemUptimeRecord.delete({ where: { id: recordId } });
    return { id: recordId };
  }
}
