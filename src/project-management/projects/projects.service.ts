import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ClientRequestActivityType, ProjectStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { viewerDepartmentCodes } from "../../common/department-scope";
import { maskUserRef } from "../../common/mask-user-ref";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import { DocumentsService } from "../../documents/documents.service";
import { TimelineExtensionsService } from "../timeline-extensions/timeline-extensions.service";
import { NotificationsService } from "../../notifications/notifications.service";
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
import { recordStageChange } from "../../common/stage-history";
import { ThreadsService } from "../../threads/threads.service";

const userSelect = { id: true, fullName: true, email: true, roles: { select: { role: true } } };
const serviceLineSelect = { id: true, code: true, name: true, isRecurring: true };
const contractSummarySelect = {
  id: true,
  contractNumber: true,
  status: true,
  value: true,
  currency: true,
  billingFrequency: true,
  startDate: true,
  endDate: true,
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly threads: ThreadsService,
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly timelineExtensionsService: TimelineExtensionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Visibility is scoped to the viewer's own department(s) — admin/CEO see everything, a
  // department-scoped viewer sees only their own department's projects, minus any `restricted`
  // project they're not the creator or a team member of (see `Project.visibility`: work one
  // person or a named few own, hidden from the rest of the department). The one deliberate
  // exception is `sharedWithMe`: a project outside the viewer's department they've been
  // explicitly added to as a team member — an opt-in grant, not a blanket leak, so it uses its
  // own narrower authorization (team membership) instead of the department-code check.
  async findAll(
    filters: {
      departmentId?: string;
      status?: ProjectStatus;
      clientId?: string;
      serviceLineId?: string;
      sharedWithMe?: boolean;
    },
    pagination: PaginationQueryDto = {},
    viewer: AuthenticatedUser,
  ) {
    const deptCodes = await viewerDepartmentCodes(viewer, this.prisma);
    return maybePaginate(
      this.prisma.project,
      {
        where: {
          ...(filters.departmentId && { departmentId: filters.departmentId }),
          ...(filters.status && { status: filters.status }),
          ...(filters.clientId && { clientId: filters.clientId }),
          ...(filters.serviceLineId && { serviceLineId: filters.serviceLineId }),
          ...(filters.sharedWithMe
            ? {
                departmentId: { not: viewer.departmentId ?? undefined },
                team: { some: { userId: viewer.id } },
              }
            : deptCodes && {
                department: { code: { in: deptCodes } },
                OR: [
                  { visibility: "department" },
                  { createdBy: viewer.id },
                  { team: { some: { userId: viewer.id } } },
                ],
              }),
        },
        include: {
          department: true,
          client: true,
          serviceLine: { select: serviceLineSelect },
          contract: { select: contractSummarySelect },
          tender: { select: { id: true, referenceNumber: true, title: true } },
          clientRequest: { select: { id: true, referenceNumber: true, title: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );
  }

  // 404 (not 403) for an out-of-scope project.
  async findOne(id: string, viewer: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        department: true,
        client: true,
        contract: true,
        serviceLine: { select: serviceLineSelect },
        tender: { select: { id: true, referenceNumber: true, title: true } },
        clientRequest: { select: { id: true, referenceNumber: true, title: true } },
      },
    });
    const deptCodes = await viewerDepartmentCodes(viewer, this.prisma);
    const needsMembershipCheck = deptCodes
      ? !deptCodes.includes(project.department.code) ||
        (project.visibility === "restricted" && project.createdBy !== viewer.id)
      : false; // admin/CEO (deptCodes === null) always see everything
    if (needsMembershipCheck) {
      const isTeamMember = await this.prisma.projectTeamMember.findFirst({
        where: { projectId: id, userId: viewer.id },
        select: { id: true },
      });
      if (!isTeamMember) throw new NotFoundException("Project not found");
    }
    return project;
  }

  async create(dto: CreateProjectDto, user: AuthenticatedUser) {
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { id: dto.departmentId },
    });
    await assertDepartmentAccess(department, user, this.prisma);
    const serviceLine = await this.resolveServiceLine(dto.serviceLineId, dto.departmentId);

    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        clientId: dto.clientId,
        contractId: dto.contractId,
        departmentId: dto.departmentId,
        serviceLineId: serviceLine?.id,
        status: dto.status,
        visibility: dto.visibility,
        engagementType: dto.engagementType ?? (serviceLine?.isRecurring ? "ongoing" : undefined),
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        createdBy: user.id,
      },
    });
    if (dto.memberIds?.length) {
      await this.grantTeamAccess(project.id, project.name, dto.memberIds, user);
    }
    return project;
  }

  // Keeps each department to its own service lines (e.g. HR projects can't pick IT's HRMS line).
  private async resolveServiceLine(serviceLineId: string | null | undefined, departmentId: string) {
    if (!serviceLineId) return null;
    const serviceLine = await this.prisma.serviceLine.findUniqueOrThrow({
      where: { id: serviceLineId },
    });
    if (serviceLine.departmentId !== departmentId) {
      throw new BadRequestException("That service line belongs to a different department");
    }
    return serviceLine;
  }

  // Additive-only: creates a ProjectTeamMember row (userId set) for anyone in `userIds` not
  // already on the team. Used by the visibility picker on create/edit — removing someone's
  // access is a separate, explicit action on the Team tab, not something this silently does.
  private async grantTeamAccess(
    projectId: string,
    projectName: string,
    userIds: string[],
    actor: AuthenticatedUser,
  ) {
    const existing = await this.prisma.projectTeamMember.findMany({
      where: { projectId, userId: { in: userIds } },
      select: { userId: true },
    });
    const already = new Set(existing.map((m) => m.userId));
    const toAdd = userIds.filter((id) => !already.has(id));
    if (toAdd.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: toAdd } },
      select: { id: true, fullName: true, email: true },
    });
    await this.prisma.projectTeamMember.createMany({
      data: users.map((u) => ({
        projectId,
        userId: u.id,
        name: u.fullName ?? u.email,
        role: "Member",
        type: "internal" as const,
      })),
    });
    await Promise.all(
      users
        .filter((u) => u.id !== actor.id)
        .map((u) =>
          this.notificationsService.notify({
            userId: u.id,
            type: "project_shared",
            title: `You were added to: ${projectName}`,
            resourceType: "project",
            resourceId: projectId,
            createdBy: actor.id,
          }),
        ),
    );
  }

  async update(id: string, dto: UpdateProjectDto, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: { department: true },
    });
    await assertDepartmentAccess(project.department, user, this.prisma);

    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if (dto.departmentId && dto.departmentId !== project.departmentId && !isAdminOrCeo) {
      throw new ForbiddenException("Only the CEO can move a project to a different department");
    }

    if (dto.serviceLineId) {
      await this.resolveServiceLine(dto.serviceLineId, dto.departmentId ?? project.departmentId);
    }
    // Linking a contract to a client-less project adopts the contract's client.
    let adoptedClientId: string | undefined;
    if (dto.contractId && !project.clientId && dto.clientId === undefined) {
      const contract = await this.prisma.contract.findUniqueOrThrow({
        where: { id: dto.contractId },
        select: { clientId: true },
      });
      adoptedClientId = contract.clientId;
    }

    const { memberIds, extensionReason, extensionAttribution, startDate, endDate, ...rest } = dto;
    const stageMoved =
      dto.deliveryStage !== undefined && dto.deliveryStage !== project.deliveryStage;
    const statusMoved = dto.status !== undefined && dto.status !== project.status;
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...rest,
        ...(stageMoved && { deliveryStageChangedAt: new Date() }),
        ...(statusMoved && { completedAt: dto.status === "completed" ? new Date() : null }),
        ...(adoptedClientId && { clientId: adoptedClientId }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      },
    });
    if (stageMoved) {
      await recordStageChange(this.prisma, {
        entityType: "project",
        entityId: id,
        from: project.deliveryStage,
        to: updated.deliveryStage,
        userId: user.id,
      });
    }
    if (memberIds?.length) await this.grantTeamAccess(id, updated.name, memberIds, user);

    // A timeline extension is only meaningful when a real previous end date got pushed later —
    // first-time-set isn't an extension, and a date moving earlier isn't either.
    if (
      dto.endDate &&
      project.endDate &&
      new Date(dto.endDate).getTime() > project.endDate.getTime() &&
      extensionReason &&
      extensionAttribution
    ) {
      await this.timelineExtensionsService.create({
        entityType: "project",
        entityId: id,
        previousDate: project.endDate,
        newDate: new Date(dto.endDate),
        reason: extensionReason,
        attributedTo: extensionAttribution,
        createdBy: user.id,
      });
    }
    return updated;
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
    await assertDepartmentAccess(project.department, user, this.prisma);

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
    await assertDepartmentAccess(project.department, user, this.prisma);

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
    await assertDepartmentAccess(milestone.project.department, user, this.prisma);

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
    await assertDepartmentAccess(milestone.project.department, user, this.prisma);
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
    dto: {
      type?: ClientRequestActivityType;
      summary: string;
      occurredAt?: string;
      parentId?: string;
    },
    user: AuthenticatedUser,
  ) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { department: true },
    });
    await assertDepartmentAccess(project.department, user, this.prisma);
    const parent = dto.parentId
      ? await this.prisma.projectActivity.findUnique({
          where: { id: dto.parentId },
          select: { id: true, parentId: true, projectId: true },
        })
      : null;
    const parentId = dto.parentId
      ? this.threads.rootOf(parent, parent?.projectId === projectId)
      : null;

    const activity = await this.prisma.projectActivity.create({
      data: {
        projectId,
        parentId,
        type: dto.type,
        summary: dto.summary,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        createdBy: user.id,
      },
      include: { creator: { select: userSelect } },
    });
    if (parentId) {
      const thread = await this.prisma.projectActivity.findMany({
        where: { OR: [{ id: parentId }, { parentId }] },
        select: { createdBy: true },
      });
      await this.threads.notifyReply({
        participantIds: thread.map((t) => t.createdBy),
        actor: user,
        where: `project "${project.name}"`,
        body: dto.summary,
        resourceType: "project",
        resourceId: projectId,
      });
    }
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
    await assertDepartmentAccess(project.department, user, this.prisma);
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
    return members.map((m) => {
      const user = m.user ? maskUserRef(m.user, viewer) : null;
      return {
        ...m,
        name: user && m.user?.fullName !== user.fullName ? user.fullName : m.name,
        user,
      };
    });
  }

  async createTeamMember(projectId: string, dto: CreateTeamMemberDto, user: AuthenticatedUser) {
    const project = await this.assertProjectAccess(projectId, user);
    const member = await this.prisma.projectTeamMember.create({
      data: { projectId, ...dto },
      include: { user: { select: userSelect } },
    });
    if (dto.userId && dto.userId !== user.id) {
      await this.notificationsService.notify({
        userId: dto.userId,
        type: "project_shared",
        title: `You were added to: ${project.name}`,
        resourceType: "project",
        resourceId: projectId,
        createdBy: user.id,
      });
    }
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
