import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma, TenderStage } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DocumentsService } from "../../documents/documents.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { maskUserRef } from "../../common/mask-user-ref";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateTenderDto } from "./dto/create-tender.dto";
import type { UpdateTenderDto } from "./dto/update-tender.dto";
import type { UpdateTenderStageDto } from "./dto/update-tender-stage.dto";
import type { CreateTenderResourceDto } from "./dto/create-tender-resource.dto";
import type { UpdateTenderResourceDto } from "./dto/update-tender-resource.dto";
import type { CreateTimeEntryDto } from "./dto/create-time-entry.dto";
import type { ConvertToContractDto } from "./dto/convert-to-contract.dto";
import type { ConvertTenderToProjectDto } from "./dto/convert-to-project.dto";
import type { CreateTenderCostItemDto } from "./dto/create-tender-cost-item.dto";
import type { UpdateTenderCostItemDto } from "./dto/update-tender-cost-item.dto";
import type { CreateTenderBondDto } from "./dto/create-tender-bond.dto";
import type { UpdateTenderBondDto } from "./dto/update-tender-bond.dto";
import type { CreateTenderPricingItemDto } from "./dto/create-tender-pricing-item.dto";
import type { UpdateTenderPricingItemDto } from "./dto/update-tender-pricing-item.dto";
import type { CreateTenderRequirementDto } from "./dto/create-tender-requirement.dto";
import type { UpdateTenderRequirementDto } from "./dto/update-tender-requirement.dto";
import type { SaveAsTemplateDto } from "./dto/save-as-template.dto";

const ALL_STAGES: TenderStage[] = ["identified", "applying", "submitted", "evaluation", "won", "lost", "withdrawn"];

export interface TenderFilters {
  departmentId?: string;
  serviceLineId?: string;
  stage?: TenderStage;
  clientId?: string;
  q?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
}

function isAdminOrCeo(user: AuthenticatedUser) {
  return user.roles.includes("system_admin") || user.roles.includes("ceo");
}

function buildWhere(filters: TenderFilters): Prisma.TenderWhereInput {
  return {
    ...(filters.departmentId && { departmentId: filters.departmentId }),
    ...(filters.serviceLineId && { serviceLineId: filters.serviceLineId }),
    ...(filters.stage && { stage: filters.stage }),
    ...(filters.clientId && { clientId: filters.clientId }),
    ...(filters.q && { title: { contains: filters.q } }),
    ...((filters.deadlineFrom || filters.deadlineTo) && {
      submissionDeadline: {
        ...(filters.deadlineFrom && { gte: new Date(filters.deadlineFrom) }),
        ...(filters.deadlineTo && { lte: new Date(filters.deadlineTo) }),
      },
    }),
  };
}

@Injectable()
export class TendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  async findAll(filters: TenderFilters, viewer: AuthenticatedUser) {
    const tenders = await this.prisma.tender.findMany({
      where: buildWhere(filters),
      include: {
        client: { select: { id: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
        serviceLine: { select: { id: true, name: true } },
        accountManager: {
          select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return tenders.map((t) => ({
      ...t,
      accountManager: t.accountManager ? maskUserRef(t.accountManager, viewer) : null,
    }));
  }

  // Real backend-side aggregation (Prisma groupBy), not client-side math — backs both the
  // Tender module's own funnel and the CEO dashboard's fixed funnel widget.
  async pipelineSummary(filters: TenderFilters) {
    const rows = await this.prisma.tender.groupBy({
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

  // Tender only timestamps createdAt/submittedAt/wonAt/lostAt (no per-stage entry timestamp
  // for in_progress, and withdrawn isn't timestamped at all), so unlike Client Requests this
  // can't cleanly report "days in every stage." What it can report honestly from those four
  // columns: how long bids take to get submitted, how long a decision takes once submitted,
  // and which currently-open tenders have been sitting the longest — the "what's stalled
  // right now" list is the actionable half of this metric.
  async timeMetrics(filters: TenderFilters) {
    const rows = await this.prisma.tender.findMany({
      where: buildWhere(filters),
      select: {
        id: true,
        title: true,
        stage: true,
        createdAt: true,
        submittedAt: true,
        wonAt: true,
        lostAt: true,
      },
    });
    const now = Date.now();
    const daysBetween = (a: Date, b: number) => (b - a.getTime()) / 86_400_000;

    const toSubmit: number[] = [];
    const toDecision: number[] = [];
    const stalled: { id: string; title: string; stage: TenderStage; days: number }[] = [];

    for (const t of rows) {
      if (t.submittedAt) {
        toSubmit.push(daysBetween(t.createdAt, t.submittedAt.getTime()));
        const decidedAt = t.wonAt ?? t.lostAt;
        if (decidedAt) toDecision.push(daysBetween(t.submittedAt, decidedAt.getTime()));
      } else if (t.stage === "identified" || t.stage === "applying") {
        stalled.push({ id: t.id, title: t.title, stage: t.stage, days: daysBetween(t.createdAt, now) });
      }
    }
    stalled.sort((a, b) => b.days - a.days);

    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, d) => s + d, 0) / xs.length) * 10) / 10 : null);

    return {
      avgDaysToSubmit: avg(toSubmit),
      avgDaysToDecision: avg(toDecision),
      stalled: stalled.slice(0, 10).map((s) => ({ ...s, days: Math.round(s.days * 10) / 10 })),
    };
  }

  async findOne(id: string, viewer: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
        serviceLine: { select: { id: true, name: true } },
        accountManager: {
          select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
        },
        contract: { select: { id: true, contractNumber: true } },
      },
    });
    return {
      ...tender,
      accountManager: tender.accountManager ? maskUserRef(tender.accountManager, viewer) : null,
    };
  }

  private async assertTenderDeptAccess(departmentId: string, user: AuthenticatedUser) {
    const department = await this.prisma.department.findUniqueOrThrow({ where: { id: departmentId } });
    assertDepartmentAccess(department, user);
  }

  async create(dto: CreateTenderDto, user: AuthenticatedUser) {
    await this.assertTenderDeptAccess(dto.departmentId, user);
    return this.prisma.tender.create({
      data: {
        ...dto,
        submissionDeadline: dto.submissionDeadline ? new Date(dto.submissionDeadline) : undefined,
        createdBy: user.id,
      },
    });
  }

  async update(id: string, dto: UpdateTenderDto, user: AuthenticatedUser) {
    const existing = await this.prisma.tender.findUniqueOrThrow({ where: { id } });
    await this.assertTenderDeptAccess(existing.departmentId, user);

    return this.prisma.tender.update({
      where: { id },
      data: {
        ...dto,
        submissionDeadline: dto.submissionDeadline ? new Date(dto.submissionDeadline) : undefined,
      },
    });
  }

  async updateStage(id: string, dto: UpdateTenderStageDto, user: AuthenticatedUser) {
    const existing = await this.prisma.tender.findUniqueOrThrow({ where: { id } });
    await this.assertTenderDeptAccess(existing.departmentId, user);

    const now = new Date();
    return this.prisma.tender.update({
      where: { id },
      data: {
        stage: dto.stage,
        submittedAt: dto.stage === "submitted" ? now : existing.submittedAt,
        wonAt: dto.stage === "won" ? now : existing.wonAt,
        lostAt: dto.stage === "lost" ? now : existing.lostAt,
        withdrawnAt: dto.stage === "withdrawn" ? now : existing.withdrawnAt,
        lostReason: dto.stage === "lost" || dto.stage === "withdrawn" ? dto.lostReason : existing.lostReason,
      },
    });
  }

  async remove(id: string) {
    await this.documentsService.deleteAllForResource("tender", id);
    return this.prisma.tender.delete({ where: { id } });
  }

  async convertToContract(id: string, dto: ConvertToContractDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({
      where: { id },
      include: { contract: true },
    });
    await this.assertTenderDeptAccess(tender.departmentId, user);

    if (tender.stage !== "won") {
      throw new BadRequestException("Only a won tender can be converted to a contract");
    }
    if (tender.contract) {
      // Idempotent — calling this twice returns the already-converted contract instead of
      // erroring or creating a duplicate (Contract.tenderId is also DB-unique as a backstop).
      return tender.contract;
    }

    const clientId = dto.clientId ?? tender.clientId;
    if (!clientId) {
      throw new BadRequestException("A client is required to create a contract from this tender");
    }

    return this.prisma.contract.create({
      data: {
        contractNumber: dto.contractNumber,
        title: tender.title,
        description: tender.description,
        clientId,
        departmentId: dto.departmentId ?? tender.departmentId,
        serviceLineId: dto.serviceLineId ?? tender.serviceLineId,
        accountManagerId: dto.accountManagerId ?? tender.accountManagerId,
        billingFrequency: dto.billingFrequency,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        value: dto.value ?? tender.estimatedValue ?? 0,
        currency: dto.currency ?? tender.currency,
        notes: dto.notes,
        tenderId: tender.id,
        createdBy: user.id,
      },
    });
  }

  // "Forward to Department" in the pipeline board: an Awarded tender becomes a live delivery
  // project. Auto-creates the billing Contract behind it too (reusing one from an earlier
  // convertToContract call if that path was already used) so the project's invoice/payment
  // tracker has a real Contract/Invoice anchor instead of inventing parallel numbers.
  async convertToProject(id: string, dto: ConvertTenderToProjectDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({
      where: { id },
      include: { contract: true, project: true },
    });
    await this.assertTenderDeptAccess(tender.departmentId, user);

    if (tender.stage !== "won") {
      throw new BadRequestException("Only an awarded tender can be forwarded to a department");
    }
    if (tender.project) {
      return tender.project;
    }

    const clientId = dto.clientId ?? tender.clientId;
    if (!clientId) {
      throw new BadRequestException("A client is required to forward this tender to a department");
    }

    const contract =
      tender.contract ??
      (await this.prisma.contract.create({
        data: {
          contractNumber: dto.contractNumber ?? `CTR-${tender.referenceNumber ?? tender.id.slice(0, 8).toUpperCase()}`,
          title: tender.title,
          description: tender.description,
          clientId,
          departmentId: tender.departmentId,
          serviceLineId: tender.serviceLineId,
          accountManagerId: tender.accountManagerId,
          billingFrequency: dto.billingFrequency ?? "one_off",
          status: "active",
          startDate: new Date(),
          value: tender.estimatedValue ?? 0,
          currency: tender.currency,
          tenderId: tender.id,
          createdBy: user.id,
        },
      }));

    return this.prisma.project.create({
      data: {
        name: dto.name ?? tender.title,
        description: tender.description,
        clientId,
        contractId: contract.id,
        tenderId: tender.id,
        departmentId: tender.departmentId,
        status: "active",
        deliveryStage: "onboarding",
        startDate: new Date(),
        createdBy: user.id,
      },
    });
  }

  /* ---------- Resources ---------- */

  async listResources(tenderId: string, viewer: AuthenticatedUser) {
    const resources = await this.prisma.tenderResource.findMany({
      where: { tenderId },
      include: { user: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    return resources.map((r) => ({ ...r, user: maskUserRef(r.user, viewer) }));
  }

  async createResource(tenderId: string, dto: CreateTenderResourceDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);

    const resource = await this.prisma.tenderResource.create({
      data: { tenderId, ...dto },
      include: { user: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
    });
    return { ...resource, user: maskUserRef(resource.user, user) };
  }

  async updateResource(resourceId: string, dto: UpdateTenderResourceDto, user: AuthenticatedUser) {
    const resource = await this.prisma.tenderResource.findUniqueOrThrow({
      where: { id: resourceId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(resource.tender.departmentId, user);

    const updated = await this.prisma.tenderResource.update({
      where: { id: resourceId },
      data: dto,
      include: { user: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
    });
    return { ...updated, user: maskUserRef(updated.user, user) };
  }

  async deleteResource(resourceId: string, user: AuthenticatedUser) {
    const resource = await this.prisma.tenderResource.findUniqueOrThrow({
      where: { id: resourceId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(resource.tender.departmentId, user);
    return this.prisma.tenderResource.delete({ where: { id: resourceId } });
  }

  /* ---------- Time entries ---------- */

  async listTimeEntries(tenderId: string, viewer: AuthenticatedUser) {
    const entries = await this.prisma.tenderTimeEntry.findMany({
      where: { tenderId },
      include: { user: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
      orderBy: { entryDate: "desc" },
    });
    return entries.map((e) => ({ ...e, user: maskUserRef(e.user, viewer) }));
  }

  async createTimeEntry(tenderId: string, dto: CreateTimeEntryDto, user: AuthenticatedUser) {
    // Any authenticated staff member can log their own time against a tender they can see —
    // logging isn't gated behind department write access (matches Tasks' "assignee can always
    // act on their own work" convention), only deleting someone else's entry is restricted.
    await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    const entry = await this.prisma.tenderTimeEntry.create({
      data: {
        tenderId,
        userId: user.id,
        entryDate: new Date(dto.entryDate),
        hours: dto.hours,
        notes: dto.notes,
        createdBy: user.id,
      },
      include: { user: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
    });
    return { ...entry, user: maskUserRef(entry.user, user) };
  }

  async deleteTimeEntry(entryId: string, user: AuthenticatedUser) {
    const entry = await this.prisma.tenderTimeEntry.findUniqueOrThrow({ where: { id: entryId } });
    if (entry.userId !== user.id && !isAdminOrCeo(user)) {
      throw new ForbiddenException("You can only delete your own time entries");
    }
    return this.prisma.tenderTimeEntry.delete({ where: { id: entryId } });
  }

  // Live aggregation, no cached totals — mirrors ProjectsService.getFinancials()'s pattern.
  // Budgeted = allocatedHours x hourlyRate per assigned resource. Actual = logged hours x that
  // same user's hourlyRate; hours logged by a user with no TenderResource row (no rate on
  // record) are still counted and shown, just excluded from the cost figure.
  async getCostSummary(tenderId: string, viewer: AuthenticatedUser) {
    const [resources, hoursByUser] = await Promise.all([
      this.prisma.tenderResource.findMany({
        where: { tenderId },
        include: { user: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
      }),
      this.prisma.tenderTimeEntry.groupBy({
        by: ["userId"],
        where: { tenderId },
        _sum: { hours: true },
      }),
    ]);

    const rateByUser = new Map(resources.map((r) => [r.userId, r.hourlyRate ? Number(r.hourlyRate) : null]));
    const budgetedCost = resources.reduce(
      (sum, r) => sum + (r.allocatedHours && r.hourlyRate ? Number(r.allocatedHours) * Number(r.hourlyRate) : 0),
      0,
    );
    const budgetedHours = resources.reduce((sum, r) => sum + (r.allocatedHours ? Number(r.allocatedHours) : 0), 0);

    let actualCost = 0;
    let ratedHours = 0;
    let unratedHours = 0;
    const byUser = hoursByUser.map((row) => {
      const hours = Number(row._sum.hours ?? 0);
      const rate = rateByUser.get(row.userId) ?? null;
      const cost = rate != null ? hours * rate : null;
      if (cost != null) {
        actualCost += cost;
        ratedHours += hours;
      } else {
        unratedHours += hours;
      }
      const resource = resources.find((r) => r.userId === row.userId);
      const maskedUser = resource ? maskUserRef(resource.user, viewer) : null;
      return {
        userId: row.userId,
        userName: maskedUser?.fullName ?? maskedUser?.email ?? null,
        hours,
        rate,
        cost,
      };
    });

    return {
      budgetedCost,
      budgetedHours,
      actualCost,
      actualHours: ratedHours + unratedHours,
      unratedHours,
      byUser,
    };
  }

  /* ---------- Cost items (non-staff pursuit cost) ---------- */

  listCostItems(tenderId: string) {
    return this.prisma.tenderCostItem.findMany({ where: { tenderId }, orderBy: { createdAt: "asc" } });
  }

  async createCostItem(tenderId: string, dto: CreateTenderCostItemDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);
    return this.prisma.tenderCostItem.create({ data: { tenderId, ...dto, createdBy: user.id } });
  }

  async updateCostItem(itemId: string, dto: UpdateTenderCostItemDto, user: AuthenticatedUser) {
    const item = await this.prisma.tenderCostItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(item.tender.departmentId, user);
    return this.prisma.tenderCostItem.update({ where: { id: itemId }, data: dto });
  }

  async deleteCostItem(itemId: string, user: AuthenticatedUser) {
    const item = await this.prisma.tenderCostItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(item.tender.departmentId, user);
    return this.prisma.tenderCostItem.delete({ where: { id: itemId } });
  }

  /* ---------- Bonds ---------- */

  listBonds(tenderId: string) {
    return this.prisma.tenderBond.findMany({ where: { tenderId }, orderBy: { createdAt: "asc" } });
  }

  async createBond(tenderId: string, dto: CreateTenderBondDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);
    return this.prisma.tenderBond.create({
      data: {
        tenderId,
        ...dto,
        issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
  }

  async updateBond(bondId: string, dto: UpdateTenderBondDto, user: AuthenticatedUser) {
    const bond = await this.prisma.tenderBond.findUniqueOrThrow({
      where: { id: bondId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(bond.tender.departmentId, user);
    return this.prisma.tenderBond.update({
      where: { id: bondId },
      data: {
        ...dto,
        issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
  }

  async deleteBond(bondId: string, user: AuthenticatedUser) {
    const bond = await this.prisma.tenderBond.findUniqueOrThrow({
      where: { id: bondId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(bond.tender.departmentId, user);
    return this.prisma.tenderBond.delete({ where: { id: bondId } });
  }

  /* ---------- Pricing items (bid price breakdown) ---------- */

  listPricingItems(tenderId: string) {
    return this.prisma.tenderPricingItem.findMany({ where: { tenderId }, orderBy: { sortOrder: "asc" } });
  }

  async createPricingItem(tenderId: string, dto: CreateTenderPricingItemDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);
    const count = await this.prisma.tenderPricingItem.count({ where: { tenderId } });
    return this.prisma.tenderPricingItem.create({ data: { tenderId, ...dto, sortOrder: count } });
  }

  async updatePricingItem(itemId: string, dto: UpdateTenderPricingItemDto, user: AuthenticatedUser) {
    const item = await this.prisma.tenderPricingItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(item.tender.departmentId, user);
    return this.prisma.tenderPricingItem.update({ where: { id: itemId }, data: dto });
  }

  async deletePricingItem(itemId: string, user: AuthenticatedUser) {
    const item = await this.prisma.tenderPricingItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(item.tender.departmentId, user);
    return this.prisma.tenderPricingItem.delete({ where: { id: itemId } });
  }

  // Live aggregation across all financial sub-resources — "cost to pursue" (human + non-staff
  // cost) is kept entirely separate from "bid price" (the pricing breakdown); nothing here
  // touches Tender.estimatedValue, which stays the quick manual figure used by the funnel.
  async getFinancialsSummary(tenderId: string) {
    const [humanCost, costItems, pricingItems, bonds] = await Promise.all([
      this.getCostSummaryTotalsOnly(tenderId),
      this.prisma.tenderCostItem.findMany({ where: { tenderId } }),
      this.prisma.tenderPricingItem.findMany({ where: { tenderId } }),
      this.prisma.tenderBond.findMany({ where: { tenderId } }),
    ]);

    const otherCostTotal = costItems.reduce((sum, c) => sum + Number(c.amount), 0);
    const bidPrice = pricingItems.reduce((sum, p) => sum + Number(p.quantity) * Number(p.unitPrice), 0);

    return {
      humanCost: humanCost.budgetedCost,
      otherCostTotal,
      totalCostToPursue: humanCost.budgetedCost + otherCostTotal,
      bidPrice,
      bondsTotal: bonds.reduce((sum, b) => sum + Number(b.amount), 0),
      bondCount: bonds.length,
    };
  }

  private async getCostSummaryTotalsOnly(tenderId: string) {
    const resources = await this.prisma.tenderResource.findMany({ where: { tenderId } });
    const budgetedCost = resources.reduce(
      (sum, r) => sum + (r.allocatedHours && r.hourlyRate ? Number(r.allocatedHours) * Number(r.hourlyRate) : 0),
      0,
    );
    return { budgetedCost };
  }

  /* ---------- Requirements ---------- */

  listRequirements(tenderId: string) {
    return this.prisma.tenderRequirement.findMany({
      where: { tenderId },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
  }

  async createRequirement(tenderId: string, dto: CreateTenderRequirementDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);
    const count = await this.prisma.tenderRequirement.count({ where: { tenderId } });
    return this.prisma.tenderRequirement.create({ data: { tenderId, ...dto, sortOrder: count } });
  }

  async updateRequirement(reqId: string, dto: UpdateTenderRequirementDto, user: AuthenticatedUser) {
    const req = await this.prisma.tenderRequirement.findUniqueOrThrow({
      where: { id: reqId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(req.tender.departmentId, user);
    return this.prisma.tenderRequirement.update({ where: { id: reqId }, data: dto });
  }

  async deleteRequirement(reqId: string, user: AuthenticatedUser) {
    const req = await this.prisma.tenderRequirement.findUniqueOrThrow({
      where: { id: reqId },
      include: { tender: true },
    });
    await this.assertTenderDeptAccess(req.tender.departmentId, user);
    return this.prisma.tenderRequirement.delete({ where: { id: reqId } });
  }

  async applyRequirementTemplate(tenderId: string, templateId: string, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);

    const template = await this.prisma.tenderRequirementTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const existingCount = await this.prisma.tenderRequirement.count({ where: { tenderId } });

    await this.prisma.tenderRequirement.createMany({
      data: template.items.map((item, i) => ({
        tenderId,
        title: item.title,
        category: item.category,
        sortOrder: existingCount + i,
      })),
    });
    return this.listRequirements(tenderId);
  }

  async saveRequirementsAsTemplate(tenderId: string, dto: SaveAsTemplateDto, user: AuthenticatedUser) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);

    const requirements = await this.prisma.tenderRequirement.findMany({
      where: { tenderId },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
    if (requirements.length === 0) {
      throw new BadRequestException("This tender has no requirements to save as a template");
    }

    return this.prisma.tenderRequirementTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        createdBy: user.id,
        items: {
          create: requirements.map((r, i) => ({ title: r.title, category: r.category, sortOrder: i })),
        },
      },
      include: { items: true },
    });
  }

  /* ---------- Activity & Communication log ---------- */

  async listActivities(tenderId: string, viewer: AuthenticatedUser) {
    const activities = await this.prisma.tenderActivity.findMany({
      where: { tenderId },
      include: {
        creator: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } },
      },
      orderBy: { occurredAt: "desc" },
    });
    return activities.map((a) => ({ ...a, creator: a.creator ? maskUserRef(a.creator, viewer) : null }));
  }

  async createActivity(
    tenderId: string,
    dto: { type?: "note" | "call" | "email" | "meeting"; summary: string; occurredAt?: string },
    user: AuthenticatedUser,
  ) {
    const tender = await this.prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    await this.assertTenderDeptAccess(tender.departmentId, user);

    const activity = await this.prisma.tenderActivity.create({
      data: {
        tenderId,
        type: dto.type,
        summary: dto.summary,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        createdBy: user.id,
      },
      include: {
        creator: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } },
      },
    });
    return { ...activity, creator: activity.creator ? maskUserRef(activity.creator, user) : null };
  }

  async deleteActivity(activityId: string, user: AuthenticatedUser) {
    const activity = await this.prisma.tenderActivity.findUniqueOrThrow({ where: { id: activityId } });
    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if (activity.createdBy !== user.id && !isAdminOrCeo) {
      throw new ForbiddenException("You can only delete your own activity entries");
    }
    return this.prisma.tenderActivity.delete({ where: { id: activityId } });
  }
}
