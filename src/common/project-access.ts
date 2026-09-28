import { ForbiddenException } from "@nestjs/common";
import type { ProjectMemberAccess, ProjectScope } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { assertDepartmentAccess } from "./assert-department-access";
import { isAdminOrCeo } from "./is-admin-or-ceo";

// The roles the project write routes allowed before company projects existed.
const PROJECT_WRITER_ROLES = [
  "finance",
  "hr",
  "it",
  "marketing",
  "tender",
  "department_head",
  "account_manager",
];

export type ProjectAccessTarget = {
  id: string;
  scope: ProjectScope;
  leadId: string | null;
  department: { id: string; code: string } | null;
};

export type CompanyProjectRole = "admin" | ProjectMemberAccess;

/** Who this person is on a company project; null when they aren't on it. */
export async function companyProjectRole(
  project: { id: string; leadId: string | null },
  user: AuthenticatedUser,
  prisma: PrismaService,
): Promise<CompanyProjectRole | null> {
  if (isAdminOrCeo(user)) return "admin";
  if (project.leadId === user.id) return "lead";
  const member = await prisma.projectTeamMember.findFirst({
    where: { projectId: project.id, userId: user.id },
    select: { access: true },
  });
  return member?.access ?? null;
}

export async function canReadCompanyProject(
  project: { id: string; leadId: string | null },
  user: AuthenticatedUser,
  prisma: PrismaService,
) {
  return (await companyProjectRole(project, user, prisma)) !== null;
}

/**
 * May add work (tasks, deliverables, files, discussions). Company projects: lead, members, CEO.
 * Department projects: department write access; `checkRole` also applies the old route roles.
 */
export async function assertProjectWrite(
  project: ProjectAccessTarget,
  user: AuthenticatedUser,
  prisma: PrismaService,
  { checkRole = false }: { checkRole?: boolean } = {},
) {
  if (project.scope === "company") {
    const role = await companyProjectRole(project, user, prisma);
    if (role === "admin" || role === "lead" || role === "member") return;
    throw new ForbiddenException(
      role === "viewer"
        ? "You can view this project but not add to it. Ask its lead to make you a member."
        : "Only people on this project can change it.",
    );
  }
  if (
    checkRole &&
    !isAdminOrCeo(user) &&
    !user.roles.some((r) => PROJECT_WRITER_ROLES.includes(r))
  ) {
    throw new ForbiddenException("You do not have permission to perform this action");
  }
  await assertDepartmentAccess(project.department!, user, prisma);
}

/** May change the project itself or its team. Company projects: the lead and the CEO only. */
export async function assertProjectManage(
  project: ProjectAccessTarget,
  user: AuthenticatedUser,
  prisma: PrismaService,
) {
  if (project.scope === "company") {
    const role = await companyProjectRole(project, user, prisma);
    if (role === "admin" || role === "lead") return;
    throw new ForbiddenException("Only the project's lead can do this.");
  }
  await assertDepartmentAccess(project.department!, user, prisma);
}

/** Prisma filter: company projects this person is on. */
export function companyProjectsOf(userId: string) {
  return {
    scope: "company" as const,
    OR: [{ leadId: userId }, { team: { some: { userId } } }],
  };
}
