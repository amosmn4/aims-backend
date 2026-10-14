import { describe, expect, it, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { ReportAccessService } from "./report-access.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "reader",
  email: "reader@example.test",
  roles: ["hr"],
  departmentId: "hr",
};

function fixture(
  kind: "department" | "project" | "individual",
  status: "draft" | "submitted" = "submitted",
) {
  const report = {
    id: "report",
    kind,
    subjectId: kind === "department" ? "hr" : "subject",
    subjectUserId: "author",
    departmentId: "hr",
    status,
    createdBy: "author",
  };
  const prisma = {
    report: { findUnique: jest.fn(async () => report) },
    project: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({
        id: "subject",
        scope: "department",
        visibility: "restricted",
        createdBy: "author",
        department: { id: "hr", code: "hr" },
      })),
    },
    department: { findUnique: jest.fn(async () => ({ id: "hr", code: "hr" })) },
    projectTeamMember: { findFirst: jest.fn(async () => null) },
    resourceAccessGrant: { findMany: jest.fn(async () => []) },
    userPermissionOverride: { findUnique: jest.fn(async () => null) },
  };
  return { report, service: new ReportAccessService(prisma as unknown as PrismaService) };
}

describe("report read boundaries", () => {
  it("hides private project reports from an uninvited department writer", async () => {
    await expect(fixture("project").service.loadReadable("report", user)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("hides another person's draft even from the CEO", async () => {
    await expect(
      fixture("individual", "draft").service.loadReadable("report", { ...user, roles: ["ceo"] }),
    ).rejects.toThrow(NotFoundException);
  });

  it("keeps another person's unsent draft private from the department head", async () => {
    await expect(
      fixture("individual", "draft").service.loadReadable("report", {
        ...user,
        roles: ["department_head"],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("allows the head to read a sent personal report", async () => {
    await expect(
      fixture("individual").service.loadReadable("report", { ...user, roles: ["department_head"] }),
    ).resolves.toMatchObject({ id: "report" });
  });

  it("preserves collaboration on the department's shared draft", async () => {
    await expect(
      fixture("department", "draft").service.loadReadable("report", user),
    ).resolves.toMatchObject({ id: "report" });
  });
});

describe("shared team report visibility", () => {
  function company(member = true) {
    const report = {
      id: "report",
      kind: "project",
      subjectId: "company",
      status: "draft",
      createdBy: "creator",
      departmentId: null,
      subjectUserId: null,
    };
    const project = {
      id: "company",
      name: "Expansion",
      scope: "company",
      departmentId: null,
      leadId: "creator",
    };
    const prisma = {
      report: { findUnique: jest.fn(async () => report) },
      project: {
        findFirst: jest.fn(async () => project),
        findUnique: jest.fn(async () => project),
      },
      projectTeamMember: { findFirst: jest.fn(async () => (member ? { access: "viewer" } : null)) },
    };
    return new ReportAccessService(prisma as unknown as PrismaService);
  }

  it("opens a teammate's draft and lets existing viewers write it", async () => {
    const service = company();
    await expect(service.loadReadable("report", user)).resolves.toMatchObject({ id: "report" });
    expect(
      await service.canWrite({ kind: "project", subjectId: "company", subjectUserId: null }, user),
    ).toBe(true);
  });

  it("lets the CEO see team drafts", async () => {
    await expect(
      company(false).loadReadable("report", { ...user, roles: ["ceo"] }),
    ).resolves.toMatchObject({ id: "report" });
  });

  it("keeps team drafts hidden from unrelated staff", async () => {
    await expect(company(false).loadReadable("report", user)).rejects.toThrow(NotFoundException);
  });

  it("routes company project reports directly to the CEO", async () => {
    expect(await company().resolveSubject("project", "company")).toMatchObject({
      name: "Expansion",
      reviewerKind: "ceo",
      departmentId: null,
    });
  });
});

describe("shared department report boundaries", () => {
  it("lets the CEO open the department's shared draft", async () => {
    await expect(
      fixture("department", "draft").service.loadReadable("report", { ...user, roles: ["ceo"] }),
    ).resolves.toMatchObject({ id: "report" });
  });

  it("keeps shared department drafts hidden from read-only staff", async () => {
    await expect(
      fixture("department", "draft").service.loadReadable("report", {
        ...user,
        roles: ["general_staff"],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("denies unrelated departments access to a department draft", async () => {
    await expect(
      fixture("department", "draft").service.loadReadable("report", {
        ...user,
        roles: ["marketing"],
        departmentId: "marketing",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("excludes denied, read-only and inactive candidates from feedback recipients", async () => {
    const prisma = {
      department: { findUnique: jest.fn(async () => ({ id: "hr", code: "hr" })) },
      user: {
        findMany: jest.fn(async (_query: unknown) => [
          { id: "writer", departmentId: "hr", roles: [{ role: "hr" }], permissionOverrides: [] },
          {
            id: "denied",
            departmentId: "hr",
            roles: [{ role: "hr" }],
            permissionOverrides: [{ action: "write", effect: "deny" }],
          },
          {
            id: "read-only",
            departmentId: "hr",
            roles: [{ role: "general_staff" }],
            permissionOverrides: [],
          },
          {
            id: "granted",
            departmentId: "other",
            roles: [{ role: "general_staff" }],
            permissionOverrides: [
              { action: "write", effect: "grant" },
              { action: "read", effect: "grant" },
            ],
          },
        ]),
      },
    };
    const service = new ReportAccessService(prisma as unknown as PrismaService);
    expect(await service.reportTeamIds({ kind: "department", subjectId: "hr" })).toEqual([
      "writer",
      "granted",
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });

  it("requires read access as well as a write grant for a shared department report", async () => {
    const prisma = {
      department: {
        findUnique: jest.fn(async () => ({ id: "hr", code: "hr" })),
        findMany: jest.fn(async () => [{ id: "hr", code: "hr" }]),
      },
      userPermissionOverride: {
        findUnique: jest.fn(
          async (query: { where: { userId_departmentId_action: { action: string } } }) => ({
            effect: query.where.userId_departmentId_action.action === "read" ? "deny" : "grant",
          }),
        ),
        findMany: jest.fn(async () => [
          { departmentId: "hr", action: "read", effect: "deny" },
          { departmentId: "hr", action: "write", effect: "grant" },
        ]),
      },
    };
    const service = new ReportAccessService(prisma as unknown as PrismaService);
    expect(
      await service.canWrite({ kind: "department", subjectId: "hr", subjectUserId: null }, user),
    ).toBe(false);
    expect(await service.sharedDepartmentIds(user)).toEqual([]);
  });

  it("includes only departments where the viewer can prepare reports", async () => {
    const prisma = {
      department: {
        findMany: jest.fn(async () => [
          { id: "hr", code: "hr" },
          { id: "it", code: "it" },
        ]),
      },
      userPermissionOverride: { findMany: jest.fn(async () => []) },
    };
    const service = new ReportAccessService(prisma as unknown as PrismaService);
    expect(await service.sharedDepartmentIds(user)).toEqual(["hr"]);
  });
});
