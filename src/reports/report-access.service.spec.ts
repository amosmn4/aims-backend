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
