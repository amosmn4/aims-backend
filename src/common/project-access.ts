import { ForbiddenException } from "@nestjs/common";
import type { Prisma, ProjectMemberAccess, ProjectScope } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { assertDepartmentAccess } from "./assert-department-access";
import { isAdminOrCeo } from "./is-admin-or-ceo";
import { can } from "./permission-resolution";
import { hasResourceGrant } from "./has-resource-grant";
import { viewerDepartmentCodes } from "./department-scope";

export type ProjectAccessTarget = {
  id: string;
  scope: ProjectScope;
  leadId: string | null;
  department: { id: string; code: string } | null;
  visibility?: "department" | "restricted";
  createdBy?: string | null;
};

export type CompanyProjectRole = "admin" | ProjectMemberAccess;

/** Who this person is on a company project; null when they aren't on it. */
export async function companyProjectRole(
  project: { id: string; leadId: string | null },
  user: AuthenticatedUser,
  prisma: PrismaService,
): Promise<CompanyProjectRole | null> {
  if (isAdminOrCeo(user)) return "admin";
  const member = await prisma.projectTeamMember.findFirst({
    where: { projectId: project.id, userId: user.id },
    select: { access: true },
  });
  return member ? "member" : null;
}

export async function canReadCompanyProject(
  project: { id: string; leadId: string | null },
  user: AuthenticatedUser,
  prisma: PrismaService,
) {
  return (await companyProjectRole(project, user, prisma)) !== null;
}

export async function canReadDepartmentProject(
  project: ProjectAccessTarget,
  user: AuthenticatedUser,
  prisma: PrismaService,
): Promise<boolean> {
  if (isAdminOrCeo(user)) return true;
  if (
    project.department &&
    (project.visibility === "department" || project.createdBy === user.id) &&
    (await can(user, project.department, "read", prisma))
  )
    return true;
  if (await hasResourceGrant("project", project.id, user, "read", prisma)) return true;
  const member = await prisma.projectTeamMember.findFirst({
    where: { projectId: project.id, userId: user.id },
    select: { id: true },
  });
  return !!member;
}

export async function readableProjectsWhere(
  user: AuthenticatedUser,
  prisma: PrismaService,
): Promise<Prisma.ProjectWhereInput> {
  const codes = await viewerDepartmentCodes(user, prisma);
  if (codes === null) return {};
  const grants = await prisma.resourceAccessGrant.findMany({
    where: {
      resourceType: "project",
      OR: [
        { userId: user.id },
        ...(user.departmentId ? [{ departmentId: user.departmentId }] : []),
      ],
    },
    select: { resourceId: true },
  });
  return {
    OR: [
      {
        scope: "department",
        OR: [
          {
            department: { code: { in: codes } },
            OR: [{ visibility: "department" }, { createdBy: user.id }],
          },
          { team: { some: { userId: user.id } } },
          { id: { in: grants.map((g) => g.resourceId) } },
        ],
      },
      companyProjectsOf(user.id),
    ],
  };
}

/** Company teams share write access; department projects use their existing permissions. */
export async function assertProjectWrite(
  project: ProjectAccessTarget,
  user: AuthenticatedUser,
  prisma: PrismaService,
) {
  if (isAdminOrCeo(user)) return;
  if (project.scope === "company") {
    const role = await companyProjectRole(project, user, prisma);
    if (role) return;
    throw new ForbiddenException("Only people on this project can change it.");
  }
  if (!(await canReadDepartmentProject(project, user, prisma)))
    throw new ForbiddenException("You do not have access to this project");
  if (await hasResourceGrant("project", project.id, user, "write", prisma)) return;
  if (!project.department)
    throw new ForbiddenException("This project has no delivering department");
  await assertDepartmentAccess(project.department, user, prisma);
}

/** Every company team member can manage the project and its team. */
export async function assertProjectManage(
  project: ProjectAccessTarget,
  user: AuthenticatedUser,
  prisma: PrismaService,
) {
  if (project.scope === "company") {
    const role = await companyProjectRole(project, user, prisma);
    if (role) return;
    throw new ForbiddenException("Only people on this project can change it.");
  }
  await assertProjectWrite(project, user, prisma);
}

/** Prisma filter: company projects this person is on. */
export function companyProjectsOf(userId: string) {
  return {
    scope: "company" as const,
    team: { some: { userId } },
  };
}
