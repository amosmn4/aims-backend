import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AppRole, type ReportKind, type ReviewerKind } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { roleGrantsDefault, can, canWithCapability } from "../common/permission-resolution";
import { userCan } from "../common/capabilities";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { hasResourceGrant } from "../common/has-resource-grant";
import {
  canReadCompanyProject,
  canReadDepartmentProject,
  companyProjectRole,
} from "../common/project-access";
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
      return {
        kind,
        subjectId,
        departmentId: p.departmentId,
        subjectUserId: null,
        name: p.name,
        reviewerKind: p.scope === "company" ? "ceo" : "none",
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
    if (department.code !== "water" && !(await can(user, department, "read", this.prisma)))
      return false;
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
      return role !== null;
    }
    if (await hasResourceGrant("project", projectId, user, "write", this.prisma)) return true;
    if (!project.department) return isAdminOrCeo(user);
    if (!(await canReadDepartmentProject(project, user, this.prisma))) return false;
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
      return !!project && canReadDepartmentProject(project, user, this.prisma);
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
    const team = await this.prisma.projectTeamMember.findMany({
      where: { projectId, userId: { not: null } },
      select: { userId: true },
    });
    return [...new Set(team.map((t) => t.userId).filter(Boolean))] as string[];
  }

  async isTeamReport(report: { kind: ReportKind; subjectId: string }) {
    if (report.kind === "department") {
      const department = await this.prisma.department.findUnique({
        where: { id: report.subjectId },
        select: { code: true },
      });
      return !!department && department.code !== "water";
    }
    if (report.kind !== "project") return false;
    const project = await this.prisma.project.findUnique({
      where: { id: report.subjectId },
      select: { scope: true },
    });
    return project?.scope === "company";
  }

  async sharedDepartmentIds(user: AuthenticatedUser) {
    const departments = await this.prisma.department.findMany({
      where: { code: { not: "water" } },
      select: { id: true, code: true },
    });
    if (isAdminOrCeo(user)) return departments.map((department) => department.id);
    const overrides = await this.prisma.userPermissionOverride.findMany({
      where: {
        userId: user.id,
        departmentId: { in: departments.map((department) => department.id) },
        action: { in: ["read", "write"] },
      },
      select: { departmentId: true, action: true, effect: true },
    });
    return departments
      .filter((department) => {
        const read = overrides.find(
          (override) => override.departmentId === department.id && override.action === "read",
        );
        const write = overrides.find(
          (override) => override.departmentId === department.id && override.action === "write",
        );
        const canRead = read
          ? read.effect === "grant"
          : roleGrantsDefault(user, department, "read");
        const canWrite = write
          ? write.effect === "grant"
          : roleGrantsDefault(user, department, "write") &&
            userCan(user, "submit_reports", department);
        return canRead && canWrite;
      })
      .map((department) => department.id);
  }

  async reportTeamIds(report: { kind: ReportKind; subjectId: string }) {
    if (report.kind !== "department") return this.projectTeamIds(report.subjectId);
    const department = await this.prisma.department.findUnique({ where: { id: report.subjectId } });
    if (!department || department.code === "water") return [];
    const people = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { departmentId: department.id },
          ...((Object.values(AppRole) as string[]).includes(department.code)
            ? [{ roles: { some: { role: department.code as AppRole } } }]
            : []),
          {
            permissionOverrides: {
              some: { departmentId: department.id, action: "write", effect: "grant" },
            },
          },
        ],
      },
      select: {
        id: true,
        departmentId: true,
        roles: { select: { role: true } },
        permissionOverrides: {
          where: { departmentId: department.id, action: { in: ["read", "write"] } },
          select: { action: true, effect: true },
        },
      },
    });
    return people
      .filter((person) => {
        const candidate = {
          id: person.id,
          email: "",
          departmentId: person.departmentId,
          roles: person.roles.map((item) => item.role),
        };
        if (isAdminOrCeo(candidate)) return true;
        const read = person.permissionOverrides.find((override) => override.action === "read");
        const canRead = read
          ? read.effect === "grant"
          : roleGrantsDefault(candidate, department, "read");
        if (!canRead) return false;
        const override = person.permissionOverrides.find((override) => override.action === "write");
        return override
          ? override.effect === "grant"
          : roleGrantsDefault(candidate, department, "write") &&
              userCan(candidate, "submit_reports", department);
      })
      .map((person) => person.id);
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
    if (report.status === "draft" && report.createdBy !== user.id) {
      const shared = await this.isTeamReport(report);
      const allowed =
        report.kind === "department"
          ? (shared && isAdminOrCeo(user)) || (await this.canWrite(report, user))
          : shared;
      if (!allowed) throw new NotFoundException("Report not found");
    }
    return report;
  }
}
