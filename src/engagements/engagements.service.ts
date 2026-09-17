import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { maskUserRef } from "../common/mask-user-ref";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { ResolveEngagementDto } from "./dto/resolve-engagement.dto";

const userSelect = { id: true, fullName: true, email: true, roles: { select: { role: true } } };
type CreatorRef = { fullName: string | null; email: string; roles: { role: string }[] } | null;

export interface ChainLead {
  id: string;
  name: string;
}
export interface ChainRequest {
  id: string;
  title: string;
  referenceNumber: string | null;
}
export interface ChainTender {
  id: string;
  title: string;
  referenceNumber: string | null;
}
export interface ChainContract {
  id: string;
  title: string;
  contractNumber: string;
}
export interface ChainProject {
  id: string;
  name: string;
}

export interface MergedActivity {
  id: string;
  source: "lead" | "request" | "tender" | "project";
  type: string;
  summary: string;
  occurredAt: Date;
  createdByName: string | null;
  parentId: string | null;
}

function creatorName(creator: CreatorRef, viewer: AuthenticatedUser): string | null {
  if (!creator) return null;
  const masked = maskUserRef(creator, viewer);
  return masked.fullName ?? masked.email;
}

// Walks the FK chain in both directions from whichever anchor record is at hand (a Tender never
// links back to a Lead/Request — it's an independent entry point — so the walk only ever
// reaches Lead/Request via a Contract or Project that itself came from a Client Request), and
// merges the four separate activity tables (Lead/ClientRequest/Tender/Project) into one
// chronological feed. This is what /engagements/$anchorType/$anchorId in the frontend renders.
@Injectable()
export class EngagementsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(dto: ResolveEngagementDto, viewer: AuthenticatedUser) {
    let lead: ChainLead | null = null;
    let request: ChainRequest | null = null;
    let tender: ChainTender | null = null;
    let contract: ChainContract | null = null;
    let projects: ChainProject[] = [];

    if (dto.type === "request") {
      const r = await this.prisma.clientRequest.findUnique({
        where: { id: dto.id },
        include: {
          convertedProject: { select: { id: true, name: true } },
          convertedContract: { select: { id: true, title: true, contractNumber: true } },
        },
      });
      if (!r) throw new NotFoundException("Client request not found");
      request = { id: r.id, title: r.title, referenceNumber: r.referenceNumber };
      if (r.convertedProject) projects.push(r.convertedProject);
      if (r.convertedContract) contract = r.convertedContract;
    } else if (dto.type === "tender") {
      const t = await this.prisma.tender.findUnique({
        where: { id: dto.id },
        include: {
          contract: { select: { id: true, title: true, contractNumber: true } },
          project: { select: { id: true, name: true } },
        },
      });
      if (!t) throw new NotFoundException("Tender not found");
      tender = { id: t.id, title: t.title, referenceNumber: t.referenceNumber };
      if (t.contract) contract = t.contract;
      if (t.project) projects.push(t.project);
    } else if (dto.type === "project") {
      const p = await this.prisma.project.findUnique({
        where: { id: dto.id },
        include: {
          tender: { select: { id: true, title: true, referenceNumber: true } },
          clientRequest: { select: { id: true, title: true, referenceNumber: true } },
          contract: { select: { id: true, title: true, contractNumber: true } },
        },
      });
      if (!p) throw new NotFoundException("Project not found");
      projects = [{ id: p.id, name: p.name }];
      if (p.tender) tender = p.tender;
      if (p.clientRequest) request = p.clientRequest;
      if (p.contract) contract = p.contract;
    } else {
      const c = await this.prisma.contract.findUnique({
        where: { id: dto.id },
        include: {
          tender: { select: { id: true, title: true, referenceNumber: true } },
          clientRequest: { select: { id: true, title: true, referenceNumber: true } },
          projects: { select: { id: true, name: true } },
        },
      });
      if (!c) throw new NotFoundException("Contract not found");
      contract = { id: c.id, title: c.title, contractNumber: c.contractNumber };
      if (c.tender) tender = c.tender;
      if (c.clientRequest) request = c.clientRequest;
      projects = c.projects;
    }

    if (request) {
      const l = await this.prisma.lead.findFirst({
        where: { convertedRequestId: request.id },
        select: { id: true, name: true },
      });
      if (l) lead = l;
    }

    const [leadActivities, requestActivities, tenderActivities, projectActivities] =
      await Promise.all([
        lead
          ? this.prisma.leadActivity.findMany({
              where: { leadId: lead.id },
              include: { creator: { select: userSelect } },
            })
          : Promise.resolve([]),
        request
          ? this.prisma.clientRequestActivity.findMany({
              where: { requestId: request.id },
              include: { creator: { select: userSelect } },
            })
          : Promise.resolve([]),
        tender
          ? this.prisma.tenderActivity.findMany({
              where: { tenderId: tender.id },
              include: { creator: { select: userSelect } },
            })
          : Promise.resolve([]),
        projects.length > 0
          ? this.prisma.projectActivity.findMany({
              where: { projectId: { in: projects.map((p) => p.id) } },
              include: { creator: { select: userSelect } },
            })
          : Promise.resolve([]),
      ]);

    const activities: MergedActivity[] = [
      ...leadActivities.map((a): MergedActivity => ({
        id: a.id,
        source: "lead",
        type: a.type,
        summary: a.summary,
        occurredAt: a.occurredAt,
        createdByName: creatorName(a.creator, viewer),
        parentId: a.parentId,
      })),
      ...requestActivities.map((a): MergedActivity => ({
        id: a.id,
        source: "request",
        type: a.type,
        summary: a.summary,
        occurredAt: a.occurredAt,
        createdByName: creatorName(a.creator, viewer),
        parentId: a.parentId,
      })),
      ...tenderActivities.map((a): MergedActivity => ({
        id: a.id,
        source: "tender",
        type: a.type,
        summary: a.summary,
        occurredAt: a.occurredAt,
        createdByName: creatorName(a.creator, viewer),
        parentId: a.parentId,
      })),
      ...projectActivities.map((a): MergedActivity => ({
        id: a.id,
        source: "project",
        type: a.type,
        summary: a.summary,
        occurredAt: a.occurredAt,
        createdByName: creatorName(a.creator, viewer),
        parentId: a.parentId,
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    return { chain: { lead, request, tender, contract, projects }, activities };
  }
}
