import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { viewerDepartmentCodes } from "../../common/department-scope";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { UpsertRecruitmentFunnelDto } from "./dto/upsert-recruitment-funnel.dto";
import type { CreatePlacementDto } from "./dto/placement.dto";

const RECRUITMENT_LINE = "RECRUITMENT";
const FUNNEL_ORDER = [
  ["applicationsReceived", "Applications received"],
  ["screened", "Screened"],
  ["interviewed", "Interviewed"],
  ["offered", "Offered"],
  ["placed", "Placed"],
] as const;

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  // Same visibility as the projects list: viewer's departments, minus restricted projects they aren't on.
  private async visibleProjectWhere(viewer: AuthenticatedUser) {
    const deptCodes = await viewerDepartmentCodes(viewer, this.prisma);
    if (deptCodes === null) return {};
    return {
      department: { code: { in: deptCodes } },
      OR: [
        { visibility: "department" as const },
        { createdBy: viewer.id },
        { team: { some: { userId: viewer.id } } },
      ],
    };
  }

  private async findVisibleRecruitmentProject(projectId: string, viewer: AuthenticatedUser) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        serviceLine: { code: RECRUITMENT_LINE },
        ...(await this.visibleProjectWhere(viewer)),
      },
      include: { department: true },
    });
    if (!project) throw new NotFoundException("Recruitment project not found");
    return project;
  }

  // Only projects on the Recruitment service line, and only those this viewer may see.
  async findAll(viewer: AuthenticatedUser) {
    return this.prisma.project.findMany({
      where: {
        serviceLine: { code: RECRUITMENT_LINE },
        ...(await this.visibleProjectWhere(viewer)),
      },
      include: { recruitmentFunnel: true, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(projectId: string, viewer: AuthenticatedUser) {
    await this.findVisibleRecruitmentProject(projectId, viewer);
    return this.prisma.recruitmentFunnel.findUnique({ where: { projectId } });
  }

  async upsert(projectId: string, dto: UpsertRecruitmentFunnelDto, user: AuthenticatedUser) {
    const project = await this.findVisibleRecruitmentProject(projectId, user);
    await assertDepartmentAccess(project.department, user, this.prisma);

    const existing = await this.prisma.recruitmentFunnel.findUnique({ where: { projectId } });
    const merged = Object.fromEntries(
      FUNNEL_ORDER.map(([key]) => [key, dto[key] ?? existing?.[key] ?? 0]),
    ) as Record<(typeof FUNNEL_ORDER)[number][0], number>;
    // Each stage is a subset of the one before it (you can't place more people than you offered).
    for (let i = 1; i < FUNNEL_ORDER.length; i++) {
      const [prevKey, prevLabel] = FUNNEL_ORDER[i - 1];
      const [key, label] = FUNNEL_ORDER[i];
      if (merged[key] > merged[prevKey]) {
        throw new BadRequestException(
          `${label} (${merged[key]}) can't be more than ${prevLabel.toLowerCase()} (${merged[prevKey]})`,
        );
      }
    }

    const data = { ...merged, notes: dto.notes, updatedBy: user.id };
    return this.prisma.recruitmentFunnel.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
  }

  async listPlacements(projectId: string, viewer: AuthenticatedUser) {
    await this.findVisibleRecruitmentProject(projectId, viewer);
    return this.prisma.recruitmentPlacement.findMany({
      where: { projectId },
      orderBy: { placedAt: "desc" },
    });
  }

  async addPlacement(projectId: string, dto: CreatePlacementDto, user: AuthenticatedUser) {
    const project = await this.findVisibleRecruitmentProject(projectId, user);
    await assertDepartmentAccess(project.department, user, this.prisma);
    const placement = await this.prisma.recruitmentPlacement.create({
      data: {
        projectId,
        candidateName: dto.candidateName.trim(),
        position: dto.position?.trim() || null,
        placedAt: new Date(dto.placedAt),
        notes: dto.notes?.trim() || null,
        createdBy: user.id,
      },
    });
    await this.syncPlacedCount(projectId, user.id);
    return placement;
  }

  async removePlacement(placementId: string, user: AuthenticatedUser) {
    const placement = await this.prisma.recruitmentPlacement.findUniqueOrThrow({
      where: { id: placementId },
    });
    const project = await this.findVisibleRecruitmentProject(placement.projectId, user);
    await assertDepartmentAccess(project.department, user, this.prisma);
    await this.prisma.recruitmentPlacement.delete({ where: { id: placementId } });
    const [remaining, funnel] = await Promise.all([
      this.prisma.recruitmentPlacement.count({ where: { projectId: placement.projectId } }),
      this.prisma.recruitmentFunnel.findUnique({ where: { projectId: placement.projectId } }),
    ]);
    if (funnel && funnel.placed > remaining) {
      await this.prisma.recruitmentFunnel.update({
        where: { projectId: placement.projectId },
        data: { placed: Math.max(remaining, funnel.placed - 1), updatedBy: user.id },
      });
    }
    return { id: placementId };
  }

  // Keeps the funnel's "placed" total at least as high as the named placements.
  private async syncPlacedCount(projectId: string, userId: string) {
    const count = await this.prisma.recruitmentPlacement.count({ where: { projectId } });
    const funnel = await this.prisma.recruitmentFunnel.findUnique({ where: { projectId } });
    if (funnel && funnel.placed >= count) return;
    const atLeast = (n: number | undefined) => Math.max(n ?? 0, count);
    await this.prisma.recruitmentFunnel.upsert({
      where: { projectId },
      create: {
        projectId,
        applicationsReceived: count,
        screened: count,
        interviewed: count,
        offered: count,
        placed: count,
        updatedBy: userId,
      },
      update: {
        applicationsReceived: atLeast(funnel?.applicationsReceived),
        screened: atLeast(funnel?.screened),
        interviewed: atLeast(funnel?.interviewed),
        offered: atLeast(funnel?.offered),
        placed: count,
        updatedBy: userId,
      },
    });
  }
}
