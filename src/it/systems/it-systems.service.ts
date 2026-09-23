import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateItSystemDto } from "./dto/create-it-system.dto";
import type { UpdateItSystemDto } from "./dto/update-it-system.dto";

import type { RecordUptimeDto } from "./dto/uptime.dto";
import type {
  CreateSystemFeatureDto,
  UpdateSystemFeatureDto,
  UpdateSystemStageDto,
} from "./dto/system-detail.dto";
import type { SdlcStage } from "@prisma/client";

@Injectable()
export class ItSystemsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.itSystem.findMany({ orderBy: { name: "asc" } });
  }

  /** The whole record: what it does, how it's built, each SDLC step and its features. */
  async findOne(id: string) {
    const system = await this.prisma.itSystem.findUniqueOrThrow({
      where: { id },
      include: {
        stages: { orderBy: { stage: "asc" } },
        features: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        uptimeRecords: { orderBy: { month: "desc" }, take: 1 },
        _count: { select: { tickets: true } },
      },
    });
    const openTickets = await this.prisma.ticket.count({
      where: { systemId: id, status: { in: ["open", "in_progress"] } },
    });
    return { ...system, openTickets };
  }

  create(dto: CreateItSystemDto) {
    return this.prisma.itSystem.create({
      data: {
        name: dto.name,
        type: dto.type,
        status: dto.status,
        owner: dto.owner,
        notes: dto.notes,
        ...this.detail(dto),
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
        ...this.detail(dto),
      },
    });
  }

  /** Only the detail fields the caller actually sent; empty text clears a field. */
  private detail(dto: UpdateItSystemDto) {
    const text = (v: string | null | undefined) =>
      v === undefined ? undefined : v?.trim() || null;
    return {
      purpose: text(dto.purpose),
      repoUrl: text(dto.repoUrl),
      docsUrl: text(dto.docsUrl),
      liveUrl: text(dto.liveUrl),
      currentStage:
        dto.currentStage === undefined ? undefined : (dto.currentStage as SdlcStage | null),
      progressPercent: dto.progressPercent === undefined ? undefined : dto.progressPercent,
      techStack:
        dto.techStack === undefined
          ? undefined
          : dto.techStack.map((t) => t.trim()).filter(Boolean),
      tools: dto.tools === undefined ? undefined : dto.tools.map((t) => t.trim()).filter(Boolean),
    };
  }

  /** One SDLC step of a system: notes, status and dates. */
  async saveStage(systemId: string, stage: SdlcStage, dto: UpdateSystemStageDto, userId: string) {
    await this.prisma.itSystem.findUniqueOrThrow({ where: { id: systemId } });
    const data = {
      status: dto.status,
      notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
      startedAt:
        dto.startedAt === undefined ? undefined : dto.startedAt ? new Date(dto.startedAt) : null,
      doneAt: dto.doneAt === undefined ? undefined : dto.doneAt ? new Date(dto.doneAt) : null,
      updatedBy: userId,
    };
    return this.prisma.itSystemStage.upsert({
      where: { systemId_stage: { systemId, stage } },
      create: { systemId, stage, ...data },
      update: data,
    });
  }

  async addFeature(systemId: string, dto: CreateSystemFeatureDto, userId: string) {
    await this.prisma.itSystem.findUniqueOrThrow({ where: { id: systemId } });
    return this.prisma.itSystemFeature.create({
      data: {
        systemId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        status: dto.status,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: userId,
      },
    });
  }

  updateFeature(featureId: string, dto: UpdateSystemFeatureDto) {
    return this.prisma.itSystemFeature.update({
      where: { id: featureId },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        status: dto.status,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async removeFeature(featureId: string) {
    await this.prisma.itSystemFeature.delete({ where: { id: featureId } });
    return { id: featureId };
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
