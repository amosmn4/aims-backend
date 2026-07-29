import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { maskUserRef } from "../../common/mask-user-ref";
import { ClientRequestsService } from "../../crm/client-requests/client-requests.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateLeadDto } from "./dto/create-lead.dto";
import type { UpdateLeadDto } from "./dto/update-lead.dto";
import type { CreateLeadActivityDto } from "./dto/create-lead-activity.dto";
import type { ConvertLeadToRequestDto } from "./dto/convert-lead-to-request.dto";

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientRequestsService: ClientRequestsService,
  ) {}

  findAll(filters: { stage?: string } = {}) {
    return this.prisma.lead.findMany({
      where: filters.stage ? { stage: filters.stage as never } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.lead.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreateLeadDto, user: AuthenticatedUser) {
    return this.prisma.lead.create({ data: { ...dto, createdBy: user.id } });
  }

  update(id: string, dto: UpdateLeadDto) {
    return this.prisma.lead.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    return this.prisma.lead.delete({ where: { id } });
  }

  async listActivities(leadId: string, viewer: AuthenticatedUser) {
    const activities = await this.prisma.leadActivity.findMany({
      where: { leadId },
      include: {
        creator: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } },
      },
      orderBy: { occurredAt: "desc" },
    });
    return activities.map((a) => ({ ...a, creator: a.creator ? maskUserRef(a.creator, viewer) : null }));
  }

  createActivity(leadId: string, dto: CreateLeadActivityDto, user: AuthenticatedUser) {
    return this.prisma.leadActivity.create({
      data: {
        leadId,
        type: dto.type,
        summary: dto.summary,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        createdBy: user.id,
      },
    });
  }

  // Once a lead is sales-ready, it becomes a real ClientRequest and enters Tender's own
  // intake/routing pipeline from there — reuses ClientRequestsService.create() directly
  // (in-process, not a second HTTP round-trip) rather than duplicating request-creation logic.
  // If the converting marketer already knows which department this is for, dto.departmentId
  // routes it immediately (ClientRequestsService.create stamps stage "assigned" for us) instead
  // of leaving it unrouted for Operations/Tender to triage separately.
  async convertToRequest(leadId: string, user: AuthenticatedUser, dto: ConvertLeadToRequestDto = {}) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    if (lead.convertedRequestId) {
      throw new BadRequestException("This lead has already been converted");
    }
    const request = await this.clientRequestsService.create(
      {
        title: lead.company ? `${lead.company} — inquiry` : `${lead.name} — inquiry`,
        description: lead.notes ?? undefined,
        prospectClientName: lead.company ?? undefined,
        contactName: lead.name,
        contactEmail: lead.contactEmail ?? undefined,
        contactPhone: lead.contactPhone ?? undefined,
        source: "marketing",
        departmentId: dto.departmentId,
        assignedToId: dto.assignedToId,
      },
      user,
    );
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { stage: "converted", convertedRequestId: request.id },
    });
    return request;
  }
}
