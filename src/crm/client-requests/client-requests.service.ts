import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ClientRequestSource, ClientRequestStage, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DocumentsService } from "../../documents/documents.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { can, canWithCapability } from "../../common/permission-resolution";
import { assertModuleWrite, canWriteModule } from "../../common/module-access";
import { viewerDepartmentCodes } from "../../common/department-scope";
import { hasResourceGrant } from "../../common/has-resource-grant";
import { maskUserRef } from "../../common/mask-user-ref";
import { TtlCache } from "../../common/ttl-cache";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateClientRequestDto } from "./dto/create-client-request.dto";
import type { UpdateClientRequestDto } from "./dto/update-client-request.dto";
import type { RouteClientRequestDto } from "./dto/route-client-request.dto";
import type { UpdateClientRequestStageDto } from "./dto/update-client-request-stage.dto";
import type { ConvertToProjectDto } from "./dto/convert-to-project.dto";
import type { ConvertToContractDto } from "./dto/convert-to-contract.dto";
import type { CreateActivityDto } from "./dto/create-activity.dto";
import { recordStageChange } from "../../common/stage-history";
import { endOfDay, startOfDay } from "../../common/date-range";
import { ThreadsService } from "../../threads/threads.service";

const ALL_STAGES: ClientRequestStage[] = [
  "new",
  "assigned",
  "engaging",
  "proposal",
  "won",
  "lost",
  "withdrawn",
];
const LOST_STAGES: ClientRequestStage[] = ["lost", "withdrawn"];

// The funnel's actual progression, in order — lost/withdrawn are exits from this line, not
// steps on it (see computePipelineSummary's cumulative-reach logic below).
const PROGRESS_STAGES: ClientRequestStage[] = ["new", "assigned", "engaging", "proposal", "won"];

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

// Operations owns intake (creates/routes every request) — it alone needs the whole queue,
// including everything still unrouted. Every other department (Tender included) only ever sees
// requests actually routed to it; their view starts at "assigned," never "new."
async function requestDeptFilter(
  viewer: AuthenticatedUser,
  prisma: PrismaService,
): Promise<Prisma.ClientRequestWhereInput> {
  const deptCodes = await viewerDepartmentCodes(viewer, prisma);
  if (deptCodes === null || deptCodes.includes("operations")) {
    return {};
  }
  return { department: { code: { in: deptCodes } } };
}

function buildWhere(filters: ClientRequestFilters): Prisma.ClientRequestWhereInput {
  return {
    ...(filters.departmentId && { departmentId: filters.departmentId }),
    ...(filters.serviceLineId && { serviceLineId: filters.serviceLineId }),
    ...(filters.stage && { stage: filters.stage }),
    ...(filters.source && { source: filters.source }),
    ...(filters.clientId && { clientId: filters.clientId }),
    ...(filters.q && {
      OR: [
        { title: { contains: filters.q } },
        { referenceNumber: { contains: filters.q } },
        { prospectClientName: { contains: filters.q } },
        { contactName: { contains: filters.q } },
        { client: { name: { contains: filters.q } } },
      ],
    }),
    ...((filters.dateFrom || filters.dateTo) && {
      createdAt: {
        ...(filters.dateFrom && { gte: startOfDay(filters.dateFrom) }),
        ...(filters.dateTo && { lte: endOfDay(filters.dateTo) }),
      },
    }),
  };
}

const userSelect = { id: true, fullName: true, email: true, roles: { select: { role: true } } };

const USER_REF = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;

@Injectable()
export class ClientRequestsService {
  private readonly pipelineSummaryCache = new TtlCache<
    {
      stage: ClientRequestStage;
      count: number;
      totalValue: number;
      cumulativeCount: number;
      conversionPct: number | null;
    }[]
  >(30_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly notificationsService: NotificationsService,
    private readonly threads: ThreadsService,
  ) {}

  // Shared by create/update/route — notify only when assignedToId is actually changing to a
  // new, different person (never on every unrelated field edit, never when unassigning).
  private async notifyIfNewlyAssigned(
    requestId: string,
    title: string,
    previousAssigneeId: string | null | undefined,
    newAssigneeId: string | null | undefined,
    actorId: string,
  ) {
    if (!newAssigneeId || newAssigneeId === previousAssigneeId || newAssigneeId === actorId) {
      return;
    }
    await this.notificationsService.notify({
      userId: newAssigneeId,
      type: "client_request_assigned",
      title: `A client request was assigned to you: ${title}`,
      resourceType: "client_request",
      resourceId: requestId,
      createdBy: actorId,
    });
  }

  async findAll(
    filters: ClientRequestFilters,
    viewer: AuthenticatedUser,
    pagination: PaginationQueryDto = {},
  ) {
    return maybePaginate(
      this.prisma.clientRequest,
      {
        where: { ...buildWhere(filters), ...(await requestDeptFilter(viewer, this.prisma)) },
        include: {
          client: { select: { id: true, name: true } },
          department: { select: { id: true, name: true, code: true } },
          serviceLine: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );
  }

  // Cached for 30s per distinct filter set *and* viewer scope — see TendersService.pipelineSummary.
  async pipelineSummary(filters: ClientRequestFilters, viewer: AuthenticatedUser) {
    const scope = await viewerDepartmentCodes(viewer, this.prisma);
    const cacheKey = JSON.stringify({ filters, scope });
    return this.pipelineSummaryCache.getOrSet(cacheKey, () =>
      this.computePipelineSummary(filters, viewer),
    );
  }

  // The funnel is a pass-through, not a Kanban snapshot — see TendersService.computePipelineSummary
  // for the full reasoning, identical here. `count`/`totalValue` stay as the live "currently in
  // this exact stage" figures; `cumulativeCount`/`conversionPct` are the funnel-specific fields,
  // attributing a lost/withdrawn request to every stage it actually reached via `lostFromStage`
  // rather than just its final `stage`.
  private async computePipelineSummary(filters: ClientRequestFilters, viewer: AuthenticatedUser) {
    const where = { ...buildWhere(filters), ...(await requestDeptFilter(viewer, this.prisma)) };
    const [liveRows, lostRows] = await Promise.all([
      this.prisma.clientRequest.groupBy({
        by: ["stage"],
        where,
        _count: { _all: true },
        _sum: { estimatedValue: true },
      }),
      this.prisma.clientRequest.groupBy({
        by: ["lostFromStage"],
        where: { ...where, stage: { in: LOST_STAGES } },
        _count: { _all: true },
      }),
    ]);

    const reachAtLeast = (progressIndex: number) => {
      let count = 0;
      for (const row of liveRows) {
        const idx = PROGRESS_STAGES.indexOf(row.stage);
        if (idx >= 0 && idx >= progressIndex) count += row._count._all;
      }
      for (const row of lostRows) {
        if (progressIndex === 0) {
          count += row._count._all;
          continue;
        }
        const idx = row.lostFromStage ? PROGRESS_STAGES.indexOf(row.lostFromStage) : -1;
        if (idx >= progressIndex) count += row._count._all;
      }
      return count;
    };

    const cumulativeByStage = new Map(PROGRESS_STAGES.map((stage, i) => [stage, reachAtLeast(i)]));

    return ALL_STAGES.map((stage) => {
      const row = liveRows.find((r) => r.stage === stage);
      const count = row?._count._all ?? 0;
      const totalValue = row?._sum.estimatedValue ? Number(row._sum.estimatedValue) : 0;
      const progressIndex = PROGRESS_STAGES.indexOf(stage);
      const cumulativeCount = progressIndex >= 0 ? (cumulativeByStage.get(stage) ?? 0) : count;
      const prevCumulative =
        progressIndex > 0 ? (cumulativeByStage.get(PROGRESS_STAGES[progressIndex - 1]) ?? 0) : null;
      const conversionPct =
        prevCumulative != null && prevCumulative > 0
          ? (cumulativeCount / prevCumulative) * 100
          : null;
      return { stage, count, totalValue, cumulativeCount, conversionPct };
    });
  }

  // Answers "where do requests fail" — counts grouped by the stage they were AT right before
  // being marked lost/withdrawn, not just the final "lost" state.
  async lostBreakdown(filters: ClientRequestFilters, viewer: AuthenticatedUser) {
    const rows = await this.prisma.clientRequest.groupBy({
      by: ["lostFromStage"],
      where: {
        ...buildWhere(filters),
        ...(await requestDeptFilter(viewer, this.prisma)),
        stage: { in: LOST_STAGES },
      },
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
  async timeInStage(filters: ClientRequestFilters, viewer: AuthenticatedUser) {
    const rows = await this.prisma.clientRequest.findMany({
      where: { ...buildWhere(filters), ...(await requestDeptFilter(viewer, this.prisma)) },
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
        avgDays: completed.length
          ? Math.round((completed.reduce((s, d) => s + d, 0) / completed.length) * 10) / 10
          : null,
        sampleSize: completed.length,
        stuckCount: stuck.length,
        oldestStuck: stuck[0]
          ? { id: stuck[0].id, title: stuck[0].title, days: Math.round(stuck[0].days * 10) / 10 }
          : null,
      };
    });
  }

  // 404 (not 403) for an out-of-scope request, same convention as Projects.findOne.
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
    const deptCodes = await viewerDepartmentCodes(viewer, this.prisma);
    const outOfScope =
      deptCodes &&
      !deptCodes.includes("operations") &&
      !deptCodes.includes("tender") &&
      (!request.department || !deptCodes.includes(request.department.code)) &&
      request.assignedToId !== viewer.id;
    if (
      outOfScope &&
      !(await hasResourceGrant("client_request", id, viewer, "read", this.prisma))
    ) {
      throw new NotFoundException("Client request not found");
    }
    return {
      ...request,
      assignedTo: request.assignedTo ? maskUserRef(request.assignedTo, viewer) : null,
    };
  }

  /** Before routing (no department yet) only operations/admin/ceo can act on a request —
   * Operations owns intake. Once routed, ownership follows the assigned department, same as
   * every other module's assertDepartmentAccess usage. `requestId`, when given, also honors an
   * explicit access grant on this specific request (see access-grant methods below). */
  private async assertAccess(
    request: { id?: string; departmentId: string | null },
    user: AuthenticatedUser,
  ) {
    if (!request.departmentId) {
      if (isAdminOrCeo(user) || user.roles.includes("operations")) return;
      throw new ForbiddenException("Only Operations can manage an unrouted request");
    }
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { id: request.departmentId },
    });
    // Operations owns intake, so it can still correct or re-route a request after routing it.
    if (await this.canWriteIntake(user)) return;
    try {
      await assertDepartmentAccess(department, user, this.prisma);
    } catch (err) {
      if (
        !request.id ||
        !(await hasResourceGrant("client_request", request.id, user, "write", this.prisma))
      ) {
        throw err;
      }
    }
  }

  async create(dto: CreateClientRequestDto, user: AuthenticatedUser) {
    // Assigning a department at creation time (e.g. a lead converted straight into a
    // department's queue) has the same effect as the separate route() step below — stamp
    // stage/routedAt here too so it doesn't sit in "new"/unrouted needlessly.
    const routedNow = dto.departmentId ? { stage: "assigned" as const, routedAt: new Date() } : {};
    const request = await this.prisma.clientRequest.create({
      data: { ...dto, ...routedNow, createdBy: user.id },
    });
    await this.notifyIfNewlyAssigned(request.id, request.title, null, dto.assignedToId, user.id);
    return request;
  }

  private canWriteIntake(user: AuthenticatedUser) {
    return canWriteModule("operations", user, this.prisma);
  }

  // Onboarding a won request must be done by someone in the department it was routed to.
  private async assertOwningDepartment(departmentId: string, user: AuthenticatedUser) {
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { id: departmentId },
    });
    if (!(await canWithCapability(user, department, "onboard_clients", this.prisma))) {
      throw new ForbiddenException(`Only the ${department.name} team can onboard this client`);
    }
  }

  async update(id: string, dto: UpdateClientRequestDto, user: AuthenticatedUser) {
    const existing = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id } });
    await this.assertAccess(existing, user);

    const departmentChanged =
      dto.departmentId !== undefined && dto.departmentId !== existing.departmentId;
    if (departmentChanged) {
      await this.assertAccess({ departmentId: dto.departmentId ?? null }, user);
    }
    // Editing the department is a (re-)route: stamp it the same way route() does.
    const routing =
      departmentChanged && dto.departmentId
        ? {
            routedAt: new Date(),
            ...(existing.stage === "new" && { stage: "assigned" as const }),
          }
        : departmentChanged && existing.stage === "assigned"
          ? { stage: "new" as const, routedAt: null }
          : {};

    const nextStage = "stage" in routing ? routing.stage : existing.stage;
    const updated = await this.prisma.clientRequest.update({
      where: { id },
      data: {
        ...dto,
        ...routing,
        ...(nextStage !== existing.stage && { stageChangedAt: new Date() }),
      },
    });
    await recordStageChange(this.prisma, {
      entityType: "client_request",
      entityId: id,
      from: existing.stage,
      to: updated.stage,
      userId: user.id,
    });
    await this.notifyIfNewlyAssigned(
      id,
      updated.title,
      existing.assignedToId,
      dto.assignedToId,
      user.id,
    );
    return updated;
  }

  async route(id: string, dto: RouteClientRequestDto, user: AuthenticatedUser) {
    const existing = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id } });
    await this.assertAccess(existing, user);

    const updated = await this.prisma.clientRequest.update({
      where: { id },
      data: {
        departmentId: dto.departmentId,
        assignedToId: dto.assignedToId,
        stage: "assigned",
        routedAt: new Date(),
        ...(existing.stage !== "assigned" && { stageChangedAt: new Date() }),
      },
    });
    await recordStageChange(this.prisma, {
      entityType: "client_request",
      entityId: id,
      from: existing.stage,
      to: "assigned",
      userId: user.id,
    });
    await this.notifyIfNewlyAssigned(
      id,
      updated.title,
      existing.assignedToId,
      dto.assignedToId,
      user.id,
    );
    return updated;
  }

  async updateStage(id: string, dto: UpdateClientRequestStageDto, user: AuthenticatedUser) {
    const existing = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id } });
    await this.assertAccess(existing, user);

    const now = new Date();
    const movingToLost = dto.stage === "lost" || dto.stage === "withdrawn";
    if (movingToLost && !dto.lostReason?.trim()) {
      throw new BadRequestException(
        dto.stage === "lost" ? "Say why the request was lost" : "Say why the request was withdrawn",
      );
    }
    const changed = dto.stage !== existing.stage;
    const updated = await this.prisma.clientRequest.update({
      where: { id },
      data: {
        stage: dto.stage,
        ...(changed && { stageChangedAt: now }),
        routedAt: dto.stage === "assigned" ? (existing.routedAt ?? now) : existing.routedAt,
        engagedAt: dto.stage === "engaging" ? (existing.engagedAt ?? now) : existing.engagedAt,
        proposalSentAt:
          dto.stage === "proposal" ? (existing.proposalSentAt ?? now) : existing.proposalSentAt,
        lostAt: movingToLost ? now : existing.lostAt,
        lostFromStage: movingToLost ? existing.stage : existing.lostFromStage,
        lostReason: movingToLost ? dto.lostReason!.trim() : existing.lostReason,
      },
    });
    await recordStageChange(this.prisma, {
      entityType: "client_request",
      entityId: id,
      from: existing.stage,
      to: dto.stage,
      userId: user.id,
    });
    return updated;
  }

  // Deleting is an intake decision, so it belongs to Operations.
  async remove(id: string, user: AuthenticatedUser) {
    await assertModuleWrite(
      "operations",
      user,
      this.prisma,
      "Only Operations can delete client requests",
    );
    await this.documentsService.deleteAllForResource("client_request", id);
    return this.prisma.clientRequest.delete({ where: { id } });
  }

  /* ---------- Access grants (share this request outside its own department) ---------- */

  async listAccessGrants(requestId: string, viewer: AuthenticatedUser) {
    const grants = await this.prisma.resourceAccessGrant.findMany({
      where: { resourceType: "client_request", resourceId: requestId },
      include: {
        user: { select: USER_REF },
        department: { select: { id: true, name: true, code: true } },
        creator: { select: USER_REF },
      },
      orderBy: { createdAt: "desc" },
    });
    return grants.map((g) => ({
      ...g,
      user: g.user ? maskUserRef(g.user, viewer) : null,
      creator: g.creator ? maskUserRef(g.creator, viewer) : null,
    }));
  }

  async createAccessGrant(
    requestId: string,
    dto: { userId?: string; departmentId?: string; level: "read" | "write" },
    user: AuthenticatedUser,
  ) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id: requestId } });
    await this.assertAccess(request, user);
    if (!dto.userId && !dto.departmentId) {
      throw new BadRequestException("Share with either a user or a department");
    }
    return this.prisma.resourceAccessGrant.create({
      data: {
        resourceType: "client_request",
        resourceId: requestId,
        userId: dto.userId,
        departmentId: dto.departmentId,
        level: dto.level,
        createdBy: user.id,
      },
    });
  }

  async deleteAccessGrant(requestId: string, grantId: string, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id: requestId } });
    await this.assertAccess(request, user);
    await this.prisma.resourceAccessGrant.deleteMany({
      where: { id: grantId, resourceType: "client_request", resourceId: requestId },
    });
    return { id: grantId };
  }

  async convertToProject(id: string, dto: ConvertToProjectDto, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({
      where: { id },
      include: { convertedProject: true },
    });
    if (!request.departmentId) {
      throw new BadRequestException("Route this request to a department before converting it");
    }
    await this.assertOwningDepartment(request.departmentId, user);
    if (request.convertedProject) {
      // Idempotent, mirrors TendersService.convertToContract — calling twice returns the
      // existing project rather than creating a duplicate (clientRequestId is DB-unique too).
      return request.convertedProject;
    }

    // Project.clientId is nullable — not every project has a client on file yet.
    const clientId = dto.clientId ?? request.clientId ?? null;

    const project = await this.prisma.project.create({
      data: {
        name: dto.name ?? request.title,
        description: request.description,
        clientId,
        departmentId: request.departmentId,
        serviceLineId: request.serviceLineId
          ? (
              await this.prisma.serviceLine.findFirst({
                where: { id: request.serviceLineId, departmentId: request.departmentId },
                select: { id: true },
              })
            )?.id
          : null,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        clientRequestId: request.id,
        createdBy: user.id,
      },
    });

    await this.prisma.clientRequest.update({
      where: { id },
      data: {
        stage: "won",
        convertedAt: new Date(),
        conversionType: "project",
        ...(request.stage !== "won" && { stageChangedAt: new Date() }),
      },
    });
    await recordStageChange(this.prisma, {
      entityType: "client_request",
      entityId: id,
      from: request.stage,
      to: "won",
      userId: user.id,
    });

    return project;
  }

  async convertToContract(id: string, dto: ConvertToContractDto, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({
      where: { id },
      include: { convertedContract: true },
    });
    if (!request.departmentId) {
      throw new BadRequestException("Route this request to a department before converting it");
    }
    await this.assertOwningDepartment(request.departmentId, user);
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
      data: {
        stage: "won",
        convertedAt: new Date(),
        conversionType: "recurring_contract",
        ...(request.stage !== "won" && { stageChangedAt: new Date() }),
      },
    });
    await recordStageChange(this.prisma, {
      entityType: "client_request",
      entityId: id,
      from: request.stage,
      to: "won",
      userId: user.id,
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
    return activities.map((a) => ({
      ...a,
      creator: a.creator ? maskUserRef(a.creator, viewer) : null,
    }));
  }

  async createActivity(requestId: string, dto: CreateActivityDto, user: AuthenticatedUser) {
    const request = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id: requestId } });
    await this.assertAccess(request, user);
    const parent = dto.parentId
      ? await this.prisma.clientRequestActivity.findUnique({
          where: { id: dto.parentId },
          select: { id: true, parentId: true, requestId: true },
        })
      : null;
    const parentId = dto.parentId
      ? this.threads.rootOf(parent, parent?.requestId === requestId)
      : null;

    const activity = await this.prisma.clientRequestActivity.create({
      data: {
        requestId,
        parentId,
        type: dto.type ?? (parentId ? "note" : undefined),
        summary: dto.summary,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        createdBy: user.id,
      },
      include: { creator: { select: userSelect } },
    });
    if (parentId) {
      const thread = await this.prisma.clientRequestActivity.findMany({
        where: { OR: [{ id: parentId }, { parentId }] },
        select: { createdBy: true },
      });
      await this.threads.notifyReply({
        participantIds: thread.map((t) => t.createdBy),
        actor: user,
        where: `request "${request.title}"`,
        body: dto.summary,
        resourceType: "client_request",
        resourceId: requestId,
      });
    }
    return { ...activity, creator: activity.creator ? maskUserRef(activity.creator, user) : null };
  }

  async deleteActivity(activityId: string, user: AuthenticatedUser) {
    const activity = await this.prisma.clientRequestActivity.findUniqueOrThrow({
      where: { id: activityId },
    });
    if (activity.createdBy !== user.id && !isAdminOrCeo(user)) {
      throw new ForbiddenException("You can only delete your own activity entries");
    }
    return this.prisma.clientRequestActivity.delete({ where: { id: activityId } });
  }
}
