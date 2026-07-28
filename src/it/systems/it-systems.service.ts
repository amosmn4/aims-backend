import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateItSystemDto } from "./dto/create-it-system.dto";
import type { UpdateItSystemDto } from "./dto/update-it-system.dto";

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
      data: { name: dto.name, type: dto.type, status: dto.status, owner: dto.owner, notes: dto.notes },
    });
  }

  update(id: string, dto: UpdateItSystemDto) {
    return this.prisma.itSystem.update({
      where: { id },
      data: { name: dto.name, type: dto.type, status: dto.status, owner: dto.owner, notes: dto.notes },
    });
  }

  remove(id: string) {
    return this.prisma.itSystem.delete({ where: { id } });
  }
}
