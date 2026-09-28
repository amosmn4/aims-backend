import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ReportKind, ReviewerKind } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { can, canWithCapability } from "../common/permission-resolution";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { hasResourceGrant } from "../common/has-resource-grant";
import { canReadCompanyProject, companyProjectRole } from "../common/project-access";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

export interface ReportSubject {
  kind: ReportKind;
  subjectId: string;
  /** The department this report rolls up to. */
  departmentId: string | null;
  /** Set only for an individual report. */
  subjectUserId: string | null;
  /** What the report is about, for its title. */
  name: string;
  reviewerKind: ReviewerKind;
}

/** Which report belongs to which subject, and who may write, read or decide on it. */
@Injectable()
export class ReportAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Heads only decide once the CEO has switched that on AND the department
   * actually has one. Otherwise everything goes to the CEO.
   */
  private async headsDecide(departmentId: string | null) {
    if (!departmentId) return false;
    const settings = await this.prisma.companySettings.findUnique({ where: { id: "company" } });
    if (!settings?.departmentHeadsReview) return false;
    const head = await this.prisma.user.findFirst({
      where: {
        departmentId,
        isActive: true,
        roles: { some: { role: "department_head" } },
      },
      select: { id: true },
    });
    return !!head;
  }

  async resolveSubject(kind: ReportKind, subjectId: string): Promise<ReportSubject> {
    if (kind === "department") {
      const d = await this.prisma.department.findUnique({ where: { id: subjectId } });
      if (!d) throw new BadRequestException("Choose a department");
      return {
        kind,
        subjectId,
        departmentId: d.id,
        subjectUserId: null,
        name: d.name,
        reviewerKind: "ceo",
      };
    }
    if (kind === "project") {
      const p = await this.prisma.project.findUnique({
        where: { id: subjectId },
        select: { id: true, name: true, departmentId: true, scope: true, leadId: true },
      });
      if (!p) throw new BadRequestException("Choose a project");
      // Project reports document the work for everyone on it; nobody approves them.
      return {
        kind,
        subjectId,
        departmentId: p.departmentId,
        subjectUserId: null,
        name: p.name,
        reviewerKind: "none",
      };
    }
    const u = await this.prisma.user.findUnique({
      where: { id: subjectId },
      select: { id: true, fullName: true, email: true, departmentId: true },
    });
    if (!u) throw new BadRequestException("Choose a person");
    return {
      kind,
      subjectId,
      departmentId: u.departmentId,
      subjectUserId: u.id,
      name: u.fullName ?? u.email,
      reviewerKind: (await this.headsDecide(u.departmentId)) ? "department_head" : "ceo",
    };
  }

  /** Whether this person may prepare and send this report. */
  async canWrite(
    report: { kind: ReportKind; subjectId: string; subjectUserId: string | null },
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (report.kind === "individual") return report.subjectUserId === user.id;
    if (report.kind === "project") return this.canWriteProject(report.subjectId, user);
    const department = await this.prisma.department.findUnique({
      where: { id: report.subjectId },
      select: { id: true, code: true },
    });
    if (!department) return false;
    return canWithCapability(user, department, "submit_reports", this.prisma);
  }

  private async canWriteProject(projectId: string, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { department: true },
    });
    if (!project) return false;
    if (project.scope === "company") {
      const role = await companyProjectRole(project, user, this.prisma);
      return role === "admin" || role === "lead" || role === "member";
    }
    if (await hasResourceGrant("project", projectId, user, "write", this.prisma)) return true;
    if (!project.department) return isAdminOrCeo(user);
    return can(user, project.department, "write", this.prisma);
  }

  /** Whether this person may open this report at all. */
  async canRead(
    report: {
      kind: ReportKind;
      subjectId: string;
      subjectUserId: string | null;
      departmentId: string | null;
    },
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (isAdminOrCeo(user)) return true;
    if (report.kind === "individual") {
      if (report.subjectUserId === user.id) return true;
      return this.isDepartmentHead(report.departmentId, user);
    }
    if (report.kind === "project") {
      const company = await this.prisma.project.findFirst({
        where: { id: report.subjectId, scope: "company" },
        select: { id: true, leadId: true },
      });
      if (company) return canReadCompanyProject(company, user, this.prisma);
      if (await hasResourceGrant("project", report.subjectId, user, "read", this.prisma)) {
        return true;
      }
      const project = await this.prisma.project.findUnique({
        where: { id: report.subjectId },
        include: { department: true },
      });
      if (!project?.department) return false;
      if (await can(user, project.department, "read", this.prisma)) return true;
      const member = await this.prisma.projectTeamMember.findFirst({
        where: { projectId: report.subjectId, userId: user.id },
        select: { id: true },
      });
      return !!member;
    }
    const department = await this.prisma.department.findUnique({
      where: { id: report.subjectId },
      select: { id: true, code: true },
    });
    if (!department) return false;
    return can(user, department, "read", this.prisma);
  }

  /** Whether this person is the one expected to approve or send it back. */
  async isReviewer(
    report: { reviewerKind: ReviewerKind; departmentId: string | null; subjectId: string },
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (report.reviewerKind === "none") return false;
    if (isAdminOrCeo(user)) return true;
    if (report.reviewerKind !== "department_head") return false;
    return this.isDepartmentHead(report.departmentId, user);
  }

  /** Everyone on a project's team, for telling them about a shared report. */
  async projectTeamIds(projectId: string) {
    const [project, team] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { leadId: true } }),
      this.prisma.projectTeamMember.findMany({
        where: { projectId, userId: { not: null } },
        select: { userId: true },
      }),
    ]);
    return [
      ...new Set([project?.leadId, ...team.map((t) => t.userId)].filter(Boolean)),
    ] as string[];
  }

  /** Company projects this person is on, for report lists. */
  async companyProjectIds(userId: string) {
    const rows = await this.prisma.project.findMany({
      where: { scope: "company", OR: [{ leadId: userId }, { team: { some: { userId } } }] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private isDepartmentHead(departmentId: string | null, user: AuthenticatedUser) {
    if (!departmentId || user.departmentId !== departmentId) return false;
    return user.roles.includes("department_head");
  }

  /** Reads a report or throws the 404 that hides it from people without access. */
  async loadReadable(id: string, user: AuthenticatedUser) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { department: true },
    });
    if (!report) throw new NotFoundException("Report not found");
    if (!(await this.canRead(report, user))) throw new NotFoundException("Report not found");
    return report;
  }
}
