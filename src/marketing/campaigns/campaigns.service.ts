import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateCampaignDto } from "./dto/create-campaign.dto";
import type { UpdateCampaignDto } from "./dto/update-campaign.dto";

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.campaign.findMany({
      include: { _count: { select: { leads: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.campaign.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { leads: true } } },
    });
  }

  create(dto: CreateCampaignDto, user: AuthenticatedUser) {
    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        channel: dto.channel,
        status: dto.status,
        budget: dto.budget,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
        createdBy: user.id,
      },
    });
  }

  update(id: string, dto: UpdateCampaignDto) {
    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        channel: dto.channel,
        status: dto.status,
        budget: dto.budget,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  remove(id: string) {
    return this.prisma.campaign.delete({ where: { id } });
  }

  // Revenue is walked off each converted lead's existing convertedRequest -> convertedContract
  // chain (the same relation path EngagementsService already resolves) rather than a new
  // revenue field — a campaign never "earns" independently of the contracts its leads become.
  async roi(id: string) {
    const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id } });
    const leads = await this.prisma.lead.findMany({
      where: { campaignId: id },
      select: {
        id: true,
        stage: true,
        convertedRequest: { select: { convertedContract: { select: { value: true } } } },
      },
    });

    const leadsCount = leads.length;
    const convertedCount = leads.filter((l) => l.stage === "converted").length;
    const revenue = leads.reduce(
      (sum, l) => sum + Number(l.convertedRequest?.convertedContract?.value ?? 0),
      0,
    );
    const conversionRate = leadsCount ? convertedCount / leadsCount : 0;
    const budget = campaign.budget ? Number(campaign.budget) : null;
    const roi = budget ? (revenue - budget) / budget : null;

    return { campaignId: id, leadsCount, convertedCount, conversionRate, revenue, budget, roi };
  }
}
