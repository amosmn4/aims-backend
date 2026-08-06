import { ForbiddenException, Injectable } from "@nestjs/common";
import type { ClientRequestActivityType, ProjectStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { maskUserRef } from "../../common/mask-user-ref";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import { DocumentsService } from "../../documents/documents.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";
import type { CreateMilestoneDto } from "./dto/create-milestone.dto";
import type { UpdateMilestoneDto } from "./dto/update-milestone.dto";
import type { CreateCostItemDto } from "./dto/create-cost-item.dto";
import type { UpdateCostItemDto } from "./dto/update-cost-item.dto";
import type { CreateTeamMemberDto } from "./dto/create-team-member.dto";
import type { UpdateTeamMemberDto } from "./dto/update-team-member.dto";
import type { CreateRaciEntryDto } from "./dto/create-raci-entry.dto";
import type { UpdateRaciEntryDto } from "./dto/update-raci-entry.dto";
import type { CreateRaidEntryDto } from "./dto/create-raid-entry.dto";
import type { UpdateRaidEntryDto } from "./dto/update-raid-entry.dto";

const userSelect = { id: true, fullName: true, email: true, roles: { select: { role: true } } };

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  // Visibility is open cross-department ("staff in one department can be involved in
  // another department's activity") — only mutations are department-gated.
  findAll(
    filters: {
      departmentId?: string;
      status?: ProjectStatus;
      clientId?: string;
      // Google-Drive-style "Shared with me": projects outside the viewer's own department that
      // they've been added to as a team member, rather than blended into a department's normal
      // project list. Requires the viewer (their id + home department) since it's relative to
      // who's asking, not a static filter value.
      sharedWithMe?: boolean;
    },
    pagination: PaginationQueryDto = {},
    viewer?: AuthenticatedUser,
  ) {
    return maybePaginate(
      this.prisma.project,
      {
        where: {
          ...(filters.departmentId && { departmentId: filters.departmentId }),
          ...(filters.status && { status: filters.status }),
          ...(filters.clientId && { clientId: filters.clientId }),
          ...(filters.sharedWithMe &&
            viewer && {
              departmentId: { not: viewer.departmentId ?? undefined },
              team: { some: { userId: viewer.id } },
            }),
        },
        include: {
          department: true,
          client: true,
          tender: { select: { id: true, referenceNumber: true, title: true } },
          clientRequest: { select: { id: true, referenceNumber: true, title: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );
  }

  findOne(id: string) {
    return this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        department: true,
        client: true,
        contract: true,
        tender: { select: { id: true, referenceNumber: true, title: true } },
        clientRequest: { select: { id: true, referenceNumber: true, title: true } },
      },
    });
  }

  async create(dto: CreateProjectDto, user: AuthenticatedUser) {
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { id: dto.departmentId },
    });
    assertDepartmentAccess(department, user);

    return this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        clientId: dto.clientId,
        contractId: dto.contractId,
        departmentId: dto.departmentId,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        createdBy: user.id,
      },
    });
  }

  async update(id: string, dto: UpdateProjectDto, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);

    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if (dto.departmentId && dto.departmentId !== project.departmentId && !isAdminOrCeo) {
      throw new ForbiddenException(
        "Only the CEO or System Administrator can move a project to a different department",
      );
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  // Department-scoped like every other mutation on this model — a department's own staff can
  // delete their own department's projects, system_admin/ceo can delete any project.
  // Tasks cascade-delete at the DB level, but their attached Documents don't (Document has
  // no DB-level FK — see DocumentsService) so they're cleaned up explicitly here first.
  async remove(id: string, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);

    const tasks = await this.prisma.task.findMany({
      where: { projectId: id },
      select: { id: true },
    });
    await Promise.all(tasks.map((t) => this.documentsService.deleteAllForResource("task", t.id)));
    await this.documentsService.deleteAllForResource("project", id);
    return this.prisma.project.delete({ where: { id } });
  }

  listMilestones(projectId: string) {
    return this.prisma.milestone.findMany({
      where: { projectId },
      orderBy: { dueDate: "asc" },
    });
  }

  async createMilestone(projectId: string, dto: CreateMilestoneDto, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);

    return this.prisma.milestone.create({
      data: {
        projectId,
        title: dto.title,
        description: dto.description,
        dueDate: new Date(dto.dueDate),
        createdBy: user.id,
      },
    });
  }

  async updateMilestone(milestoneId: string, dto: UpdateMilestoneDto, user: AuthenticatedUser) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      include: { project: { include: { department: true } } },
    });
    assertDepartmentAccess(milestone.project.department, user);

    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async removeMilestone(milestoneId: string, user: AuthenticatedUser) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      include: { project: { include: { department: true } } },
    });
    assertDepartmentAccess(milestone.project.department, user);
    return this.prisma.milestone.delete({ where: { id: milestoneId } });
  }

  // Financials are read live from Budget/Invoice via the project's linked contract —
  // no separate project-financials table, so there's nothing to keep in sync.
  async getFinancials(projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (!project.contractId) {
      return { hasContract: false as const };
    }

    const [budgets, invoices] = await Promise.all([
      this.prisma.budget.findMany({
        where: { contractId: project.contractId },
        orderBy: { periodStart: "desc" },
      }),
      this.prisma.invoice.findMany({
        where: { contractId: project.contractId },
        include: { payments: true },
        orderBy: { issueDate: "desc" },
      }),
    ]);

    const invoiceRows = invoices.map((inv) => {
      const total = Number(inv.total);
      const paid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: inv.status,
        total,
        directCost: Number(inv.directCost),
        paid,
        outstanding: total - paid,
      };
    });

    const billable = invoiceRows.filter((inv) => inv.status !== "draft" && inv.status !== "void");
    const totalBudgeted = budgets.reduce((sum, b) => sum + Number(b.budgetedAmount), 0);
    const totalInvoiced = billable.reduce((sum, inv) => sum + inv.total, 0);
    const totalDirectCost = billable.reduce((sum, inv) => sum + inv.directCost, 0);
    const totalPaid = billable.reduce((sum, inv) => sum + inv.paid, 0);

    return {
      hasContract: true as const,
      contractId: project.contractId,
      budgets: budgets.map((b) => ({
        id: b.id,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        budgetedAmount: Number(b.budgetedAmount),
        currency: b.currency,
      })),
      invoices: invoiceRows,
      totals: {
        totalBudgeted,
        totalInvoiced,
        totalDirectCost,
        totalPaid,
        totalOutstanding: totalInvoiced - totalPaid,
        margin: totalInvoiced - totalDirectCost,
      },
    };
  }

  /* ---------- Activity & Communication log ---------- */

  async listActivities(projectId: string, viewer: AuthenticatedUser) {
    const activities = await this.prisma.projectActivity.findMany({
      where: { projectId },
      include: { creator: { select: userSelect } },
      orderBy: { occurredAt: "desc" },
    });
    return activities.map((a) => ({
      ...a,
      creator: a.creator ? maskUserRef(a.creator, viewer) : null,
    }));
  }

  async createActivity(
    projectId: string,
    dto: { type?: ClientRequestActivityType; summary: string; occurredAt?: string },
    user: AuthenticatedUser,
  ) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);

    const activity = await this.prisma.projectActivity.create({
      data: {
        projectId,
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
    const activity = await this.prisma.projectActivity.findUniqueOrThrow({
      where: { id: activityId },
    });
    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if (activity.createdBy !== user.id && !isAdminOrCeo) {
      throw new ForbiddenException("You can only delete your own activity entries");
    }
    return this.prisma.projectActivity.delete({ where: { id: activityId } });
  }

  /** Shared by every Project Workspace sub-resource (cost items, team, RACI, RAID) — fetch the
   * parent project with its department and assert access once instead of repeating the
   * findUniqueOrThrow + assertDepartmentAccess pair at every call site. */
  private async assertProjectAccess(projectId: string, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);
    return project;
  }

  /* ---------- Cost items (Financials tab: budget vs actual by category) ---------- */

  listCostItems(projectId: string) {
    return this.prisma.projectCostItem.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    });
  }

  async createCostItem(projectId: string, dto: CreateCostItemDto, user: AuthenticatedUser) {
    await this.assertProjectAccess(projectId, user);
    return this.prisma.projectCostItem.create({
      data: { projectId, ...dto, createdBy: user.id },
    });
  }

  async updateCostItem(itemId: string, dto: UpdateCostItemDto, user: AuthenticatedUser) {
    const item = await this.prisma.projectCostItem.findUniqueOrThrow({ where: { id: itemId } });
    await this.assertProjectAccess(item.projectId, user);
    return this.prisma.projectCostItem.update({ where: { id: itemId }, data: dto });
  }

  async deleteCostItem(itemId: string, user: AuthenticatedUser) {
    const item = await this.prisma.projectCostItem.findUniqueOrThrow({ where: { id: itemId } });
    await this.assertProjectAccess(item.projectId, user);
    return this.prisma.projectCostItem.delete({ where: { id: itemId } });
  }

  /* ---------- Team & Resources ---------- */

  async listTeam(projectId: string, viewer: AuthenticatedUser) {
    const members = await this.prisma.projectTeamMember.findMany({
      where: { projectId },
      include: { user: { select: userSelect } },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({ ...m, user: m.user ? maskUserRef(m.user, viewer) : null }));
  }

  async createTeamMember(projectId: string, dto: CreateTeamMemberDto, user: AuthenticatedUser) {
    await this.assertProjectAccess(projectId, user);
    const member = await this.prisma.projectTeamMember.create({
      data: { projectId, ...dto },
      include: { user: { select: userSelect } },
    });
    return { ...member, user: member.user ? maskUserRef(member.user, user) : null };
  }

  async updateTeamMember(memberId: string, dto: UpdateTeamMemberDto, user: AuthenticatedUser) {
    const member = await this.prisma.projectTeamMember.findUniqueOrThrow({
      where: { id: memberId },
    });
    await this.assertProjectAccess(member.projectId, user);
    const updated = await this.prisma.projectTeamMember.update({
      where: { id: memberId },
      data: dto,
      include: { user: { select: userSelect } },
    });
    return { ...updated, user: updated.user ? maskUserRef(updated.user, user) : null };
  }

  async deleteTeamMember(memberId: string, user: AuthenticatedUser) {
    const member = await this.prisma.projectTeamMember.findUniqueOrThrow({
      where: { id: memberId },
    });
    await this.assertProjectAccess(member.projectId, user);
    return this.prisma.projectTeamMember.delete({ where: { id: memberId } });
  }

  /* ---------- RACI matrix ---------- */

  listRaci(projectId: string) {
    return this.prisma.projectRaciEntry.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async createRaciEntry(projectId: string, dto: CreateRaciEntryDto, user: AuthenticatedUser) {
    await this.assertProjectAccess(projectId, user);
    const count = await this.prisma.projectRaciEntry.count({ where: { projectId } });
    return this.prisma.projectRaciEntry.create({ data: { projectId, ...dto, sortOrder: count } });
  }

  async updateRaciEntry(entryId: string, dto: UpdateRaciEntryDto, user: AuthenticatedUser) {
    const entry = await this.prisma.projectRaciEntry.findUniqueOrThrow({ where: { id: entryId } });
    await this.assertProjectAccess(entry.projectId, user);
    return this.prisma.projectRaciEntry.update({ where: { id: entryId }, data: dto });
  }

  async deleteRaciEntry(entryId: string, user: AuthenticatedUser) {
    const entry = await this.prisma.projectRaciEntry.findUniqueOrThrow({ where: { id: entryId } });
    await this.assertProjectAccess(entry.projectId, user);
    return this.prisma.projectRaciEntry.delete({ where: { id: entryId } });
  }

  /* ---------- RAID log ---------- */

  listRaid(projectId: string) {
    return this.prisma.projectRaidEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createRaidEntry(projectId: string, dto: CreateRaidEntryDto, user: AuthenticatedUser) {
    await this.assertProjectAccess(projectId, user);
    return this.prisma.projectRaidEntry.create({ data: { projectId, ...dto, createdBy: user.id } });
  }

  async updateRaidEntry(entryId: string, dto: UpdateRaidEntryDto, user: AuthenticatedUser) {
    const entry = await this.prisma.projectRaidEntry.findUniqueOrThrow({ where: { id: entryId } });
    await this.assertProjectAccess(entry.projectId, user);
    return this.prisma.projectRaidEntry.update({ where: { id: entryId }, data: dto });
  }

  async deleteRaidEntry(entryId: string, user: AuthenticatedUser) {
    const entry = await this.prisma.projectRaidEntry.findUniqueOrThrow({ where: { id: entryId } });
    await this.assertProjectAccess(entry.projectId, user);
    return this.prisma.projectRaidEntry.delete({ where: { id: entryId } });
  }
}
