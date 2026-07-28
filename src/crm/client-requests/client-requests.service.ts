import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { ClientRequestSource, ClientRequestStage, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DocumentsService } from "../../documents/documents.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { maskUserRef } from "../../common/mask-user-ref";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateClientRequestDto } from "./dto/create-client-request.dto";
import type { UpdateClientRequestDto } from "./dto/update-client-request.dto";
import type { RouteClientRequestDto } from "./dto/route-client-request.dto";
import type { UpdateClientRequestStageDto } from "./dto/update-client-request-stage.dto";
import type { ConvertToProjectDto } from "./dto/convert-to-project.dto";
import type { ConvertToContractDto } from "./dto/convert-to-contract.dto";
import type { CreateActivityDto } from "./dto/create-activity.dto";

const ALL_STAGES: ClientRequestStage[] = ["new", "assigned", "engaging", "proposal", "won", "lost", "withdrawn"];
const LOST_STAGES: ClientRequestStage[] = ["lost", "withdrawn"];

export interface ClientRequestFilters {
  departmentId?: string;
  serviceLineId?: string;
  stage?: ClientRequestStage;
  source?: ClientRequestSource;
  clientId?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

function isAdminOrCeo(user: AuthenticatedUser) {
  return user.roles.includes("system_admin") || user.roles.includes("ceo");
}

function buildWhere(filters: ClientRequestFilters): Prisma.ClientRequestWhereInput {
  return {
    ...(filters.departmentId && { departmentId: filters.departmentId }),
    ...(filters.serviceLineId && { serviceLineId: filters.serviceLineId }),
    ...(filters.stage && { stage: filters.stage }),
    ...(filters.source && { source: filters.source }),
    ...(filters.clientId && { clientId: filters.clientId }),
    ...(filters.q && { title: { contains: filters.q } }),
    ...((filters.dateFrom || filters.dateTo) && {
      createdAt: {
        ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
        ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
      },
    }),
  };
}

const userSelect = { id: true, fullName: true, email: true, roles: { select: { role: true } } };

@Injectable()
export class ClientRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  findAll(filters: ClientRequestFilters) {
    return this.prisma.clientRequest.findMany({
      where: buildWhere(filters),
      include: {
        client: { select: { id: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
        serviceLine: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async pipelineSummary(filters: ClientRequestFilters) {
    const rows = await this.prisma.clientRequest.groupBy({
      by: ["stage"],
      where: buildWhere(filters),
      _count: { _all: true },
      _sum: { estimatedValue: true },
    });
    return ALL_STAGES.map((stage) => {
      const row = rows.find((r) => r.stage === stage);
      return {
        stage,
        count: row?._count._all ?? 0,
        totalValue: row?._sum.estimatedValue ? Number(row._sum.estimatedValue) : 0,
      };
    });
  }

  // Answers "where do requests fail" — counts grouped by the stage they were AT right before
  // being marked lost/withdrawn, not just the final "lost" state.
  async lostBreakdown(filters: ClientRequestFilters) {
    const rows = await this.prisma.clientRequest.groupBy({
      by: ["lostFromStage"],
      where: { ...buildWhere(filters), stage: { in: LOST_STAGES } },
      _count: { _all: true },
    });
    return rows
      .filter((r) => r.lostFromStage != null)
      .map((r) => ({ stage: r.lostFromStage as ClientRequestStage, count: r._count._all }));
  }

  // "Where do requests fail" (lostBreakdown, above) answers WHICH stage; this answers HOW
  // LONG they sit there before something happens — the CEO dashboard shows counts, never
  // duration, so a request that's been "routed" for three weeks looks identical to one routed
  // an hour ago. Computed from timestamps already captured on every stage transition — no
  // schema change. `stuck` covers requests still sitting in that stage right now, which is
  // the actionable half of this: not "how long did it take historically" but "what's overdue
  // today."
  async timeInStage(filters: ClientRequestFilters) {
    const rows = await this.prisma.clientRequest.findMany({
      where: buildWhere(filters),
      select: {
        id: true,
        title: true,
        createdAt: true,
        routedAt: true,
        engagedAt: true,
        proposalSentAt: true,
        convertedAt: true,
        lostAt: true,
        lostFromStage: true,
        stage: true,
      },
    });
    const now = Date.now();
    const daysBetween = (a: Date, b: number) => (b - a.getTime()) / 86_400_000;

    const stages: {
      stage: "new" | "assigned" | "engaging" | "proposal";
      entryField: "createdAt" | "routedAt" | "engagedAt" | "proposalSentAt";
      exitFields: ("routedAt" | "engagedAt" | "proposalSentAt" | "convertedAt")[];
    }[] = [
      { stage: "new", entryField: "createdAt", exitFields: ["routedAt"] },
      { stage: "assigned", entryField: "routedAt", exitFields: ["engagedAt"] },
      { stage: "engaging", entryField: "engagedAt", exitFields: ["proposalSentAt"] },
      { stage: "proposal", entryField: "proposalSentAt", exitFields: ["convertedAt"] },
    ];

    return stages.map(({ stage, entryField, exitFields }) => {
      const completed: number[] = [];
      const stuck: { id: string; title: string; days: number }[] = [];

      for (const r of rows) {
        const entry = r[entryField];
        if (!entry) continue;

        const exit = exitFields.map((f) => r[f]).find((d) => d != null) as Date | undefined;
        const leftViaLoss = r.lostAt && r.lostFromStage === stage ? r.lostAt : undefined;
        const resolvedAt = exit ?? leftViaLoss;

        if (resolvedAt) {
          completed.push(daysBetween(entry, resolvedAt.getTime()));
        } else if (r.stage === stage) {
          stuck.push({ id: r.id, title: r.title, days: daysBetween(entry, now) });
        }
      }

      stuck.sort((a, b) => b.days - a.days);
      return {
        stage,
        avgDays: completed.length ? Math.round((completed.reduce((s, d) => s + d, 0) / completed.length) * 10) / 10 : null,
        sampleSize: completed.length,
        stuckCount: stuck.length,
        oldestStuck: stuck[0] ? { id: stuck[0].id, title: stuck[0].title, days: Math.round(stuck[0].days * 10) / 10 } : null,
      };
    });
  }

  async findOne(id: string, viewer: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
        serviceLine: { select: { id: true, name: true } },
        assignedTo: { select: userSelect },
        convertedProject: { select: { id: true, name: true } },
        convertedContract: { select: { id: true, contractNumber: true } },
        convertedFromLead: { select: { id: true, name: true } },
      },
    });
    return { ...request, assignedTo: request.assignedTo ? maskUserRef(request.assignedTo, viewer) : null };
  }

  /** Before routing (no department yet) only tender/admin/ceo can act on a request — Tender
   * owns intake (same team as the pre-project Tender pipeline). Once routed, ownership follows
   * the assigned department, same as every other module's assertDepartmentAccess usage. */
  private async assertAccess(request: { departmentId: string | null }, user: AuthenticatedUser) {
    if (!request.departmentId) {
      if (isAdminOrCeo(user) || user.roles.includes("tender")) return;
      throw new ForbiddenException("Only Tender can manage an unrouted request");
    }
    const department = await this.prisma.department.findUniqueOrThrow({ where: { id: request.departmentId } });
    assertDepartmentAccess(department, user);
  }

  async create(dto: CreateClientRequestDto, user: AuthenticatedUser) {
    return this.prisma.clientRequest.create({
      data: { ...dto, createdBy: user.id },
    });
  }

  async update(id: string, dto: UpdateClientRequestDto, user: AuthenticatedUser) {
    const existing = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id } });
    await this.assertAccess(existing, user);
    return this.prisma.clientRequest.update({ where: { id }, data: dto });
  }

  async route(id: string, dto: RouteClientRequestDto, user: AuthenticatedUser) {
    const existing = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id } });
    await this.assertAccess(existing, user);

    return this.prisma.clientRequest.update({
      where: { id },
      data: {
        departmentId: dto.departmentId,
        assignedToId: dto.assignedToId,
        stage: "assigned",
        routedAt: new Date(),
      },
    });
  }

  async updateStage(id: string, dto: UpdateClientRequestStageDto, user: AuthenticatedUser) {
    const existing = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id } });
    await this.assertAccess(existing, user);

    const now = new Date();
    const movingToLost = dto.stage === "lost" || dto.stage === "withdrawn";
    return this.prisma.clientRequest.update({
      where: { id },
      data: {
        stage: dto.stage,
        engagedAt: dto.stage === "engaging" ? now : existing.engagedAt,
        proposalSentAt: dto.stage === "proposal" ? now : existing.proposalSentAt,
        lostAt: movingToLost ? now : existing.lostAt,
        lostFromStage: movingToLost ? existing.stage : existing.lostFromStage,
        lostReason: movingToLost ? dto.lostReason : existing.lostReason,
      },
    });
  }

  async remove(id: string) {
    await this.documentsService.deleteAllForResource("client_request", id);
    return this.prisma.clientRequest.delete({ where: { id } });
  }

  async convertToProject(id: string, dto: ConvertToProjectDto, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({
      where: { id },
      include: { convertedProject: true },
    });
    await this.assertAccess(request, user);
    if (!request.departmentId) {
      throw new BadRequestException("Route this request to a department before converting it");
    }
    if (request.convertedProject) {
      // Idempotent, mirrors TendersService.convertToContract — calling twice returns the
      // existing project rather than creating a duplicate (clientRequestId is DB-unique too).
      return request.convertedProject;
    }

    const clientId = dto.clientId ?? request.clientId;
    if (!clientId) {
      throw new BadRequestException("A client is required to create a project from this request");
    }

    const project = await this.prisma.project.create({
      data: {
        name: dto.name ?? request.title,
        description: request.description,
        clientId,
        departmentId: request.departmentId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        clientRequestId: request.id,
        createdBy: user.id,
      },
    });

    await this.prisma.clientRequest.update({
      where: { id },
      data: { stage: "won", convertedAt: new Date(), conversionType: "project" },
    });

    return project;
  }

  async convertToContract(id: string, dto: ConvertToContractDto, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({
      where: { id },
      include: { convertedContract: true },
    });
    await this.assertAccess(request, user);
    if (!request.departmentId) {
      throw new BadRequestException("Route this request to a department before converting it");
    }
    if (request.convertedContract) {
      return request.convertedContract;
    }

    const clientId = dto.clientId ?? request.clientId;
    if (!clientId) {
      throw new BadRequestException("A client is required to create a contract from this request");
    }

    const contract = await this.prisma.contract.create({
      data: {
        contractNumber: dto.contractNumber,
        title: request.title,
        description: request.description,
        clientId,
        departmentId: request.departmentId,
        serviceLineId: dto.serviceLineId ?? request.serviceLineId,
        accountManagerId: dto.accountManagerId ?? request.assignedToId,
        billingFrequency: dto.billingFrequency,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        value: dto.value ?? request.estimatedValue ?? 0,
        currency: dto.currency ?? request.currency,
        notes: dto.notes,
        clientRequestId: request.id,
        createdBy: user.id,
      },
    });

    await this.prisma.clientRequest.update({
      where: { id },
      data: { stage: "won", convertedAt: new Date(), conversionType: "recurring_contract" },
    });

    return contract;
  }

  /* ---------- Activities ---------- */

  async listActivities(requestId: string, viewer: AuthenticatedUser) {
    const activities = await this.prisma.clientRequestActivity.findMany({
      where: { requestId },
      include: { creator: { select: userSelect } },
      orderBy: { occurredAt: "desc" },
    });
    return activities.map((a) => ({ ...a, creator: a.creator ? maskUserRef(a.creator, viewer) : null }));
  }

  async createActivity(requestId: string, dto: CreateActivityDto, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id: requestId } });
    await this.assertAccess(request, user);

    const activity = await this.prisma.clientRequestActivity.create({
      data: {
        requestId,
        type: dto.type,
        summary: dto.summary,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        createdBy: user.id,
      },
      include: { creator: { select: userSelect } },
    });
    return { ...activity, creator: activity.creator ? maskUserRef(activity.creator, user) : null };
  }

  async deleteActivity(activityId: string, user: AuthenticatedUser) {
    const activity = await this.prisma.clientRequestActivity.findUniqueOrThrow({ where: { id: activityId } });
    if (activity.createdBy !== user.id && !isAdminOrCeo(user)) {
      throw new ForbiddenException("You can only delete your own activity entries");
    }
    return this.prisma.clientRequestActivity.delete({ where: { id: activityId } });
  }
}
