import { describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import {
  assertProjectManage,
  assertProjectWrite,
  canReadDepartmentProject,
  canReadCompanyProject,
  companyProjectsOf,
  type ProjectAccessTarget,
} from "./project-access";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["operations"],
  departmentId: "operations",
};
const project: ProjectAccessTarget = {
  id: "project",
  scope: "department",
  leadId: null,
  visibility: "department",
  createdBy: "other",
  department: { id: "operations", code: "operations" },
};

function fixture({
  grant,
  member = false,
  override,
  companyAccess,
}: {
  grant?: "read" | "write";
  member?: boolean;
  override?: "grant" | "deny";
  companyAccess?: "viewer" | "member";
} = {}) {
  return {
    resourceAccessGrant: {
      findMany: jest.fn(async () =>
        grant ? [{ userId: user.id, departmentId: null, level: grant }] : [],
      ),
    },
    projectTeamMember: {
      findFirst: jest.fn(async () =>
        member || companyAccess ? { id: "membership", access: companyAccess ?? "member" } : null,
      ),
    },
    userPermissionOverride: {
      findUnique: jest.fn(async () => (override ? { effect: override } : null)),
    },
  } as unknown as PrismaService;
}

describe("project permissions", () => {
  it("allows Operations to add work using its department permission", async () => {
    await expect(assertProjectWrite(project, user, fixture())).resolves.toBeUndefined();
  });

  it("allows a personal write override without requiring a department role", async () => {
    await expect(
      assertProjectWrite(
        project,
        { ...user, roles: ["general_staff"] },
        fixture({ override: "grant" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("honours a write deny", async () => {
    await expect(assertProjectWrite(project, user, fixture({ override: "deny" }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("hides a restricted project from an uninvited department writer", async () => {
    const restricted = { ...project, visibility: "restricted" as const };
    expect(await canReadDepartmentProject(restricted, user, fixture())).toBe(false);
    await expect(assertProjectWrite(restricted, user, fixture())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("lets the creator and invited team see restricted work", async () => {
    const restricted = { ...project, visibility: "restricted" as const };
    expect(
      await canReadDepartmentProject({ ...restricted, createdBy: user.id }, user, fixture()),
    ).toBe(true);
    expect(await canReadDepartmentProject(restricted, user, fixture({ member: true }))).toBe(true);
  });

  it("requires department read access for a restricted project's creator unless invited or shared", async () => {
    const restricted = { ...project, visibility: "restricted" as const, createdBy: user.id };
    expect(await canReadDepartmentProject(restricted, user, fixture({ override: "deny" }))).toBe(
      false,
    );
    expect(
      await canReadDepartmentProject(restricted, user, fixture({ override: "deny", member: true })),
    ).toBe(true);
  });

  it("keeps a cross-department read grant read-only", async () => {
    const other = { ...project, department: { id: "hr", code: "hr" } };
    expect(await canReadDepartmentProject(other, user, fixture({ grant: "read" }))).toBe(true);
    await expect(assertProjectWrite(other, user, fixture({ grant: "read" }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("accepts a cross-department write grant", async () => {
    await expect(
      assertProjectWrite(
        { ...project, department: { id: "hr", code: "hr" } },
        user,
        fixture({ grant: "write" }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each(["viewer", "member"] as const)(
    "gives a company %s equal write and management rights",
    async (access) => {
      const company = { ...project, scope: "company" as const, department: null };
      await expect(
        assertProjectWrite(company, user, fixture({ companyAccess: access })),
      ).resolves.toBeUndefined();
      await expect(
        assertProjectManage(company, user, fixture({ companyAccess: access })),
      ).resolves.toBeUndefined();
    },
  );

  it("revokes a removed creator's access even when the historical lead reference remains", async () => {
    const company = { ...project, scope: "company" as const, leadId: user.id, department: null };
    expect(await canReadCompanyProject(company, user, fixture())).toBe(false);
    await expect(assertProjectManage(company, user, fixture())).rejects.toThrow(ForbiddenException);
    expect(companyProjectsOf(user.id)).toEqual({
      scope: "company",
      team: { some: { userId: user.id } },
    });
  });

  it("does not let a department writer manage an unrelated company project", async () => {
    await expect(
      assertProjectWrite({ ...project, scope: "company", department: null }, user, fixture()),
    ).rejects.toThrow(ForbiddenException);
  });
});
