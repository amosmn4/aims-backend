import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { UpsertRecruitmentFunnelDto } from "./dto/upsert-recruitment-funnel.dto";

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertProjectAccess(projectId: string, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);
    return project;
  }

  // Every HR project, each with its funnel if tracking has started — backs the Recruitment
  // tab's table (one row per engagement). Read-only and unscoped beyond "is an HR project"
  // (no PII here, just aggregate counts) — mutation is what's actually gated, via
  // assertProjectAccess below, matching the open-read/gated-write convention used elsewhere.
  async findAll() {
    return this.prisma.project.findMany({
      where: { department: { code: "hr" } },
      include: { recruitmentFunnel: true, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(projectId: string, user: AuthenticatedUser) {
    await this.assertProjectAccess(projectId, user);
    return this.prisma.recruitmentFunnel.findUnique({ where: { projectId } });
  }

  async upsert(projectId: string, dto: UpsertRecruitmentFunnelDto, user: AuthenticatedUser) {
    await this.assertProjectAccess(projectId, user);
    return this.prisma.recruitmentFunnel.upsert({
      where: { projectId },
      create: { projectId, ...dto, updatedBy: user.id },
      update: { ...dto, updatedBy: user.id },
    });
  }
}
