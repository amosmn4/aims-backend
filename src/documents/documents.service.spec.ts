import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DocumentsService } from "./documents.service";
import { ReportAccessService } from "../reports/report-access.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "owner",
  email: "owner@example.test",
  roles: ["hr"],
  departmentId: "hr",
};

function fixture(latestVersionId: string | null = "own-version") {
  const versions = [
    {
      id: "own-version",
      documentId: "own-document",
      fileName: "own.pdf",
      storagePath: "own.pdf",
      mimeType: "application/pdf",
    },
    {
      id: "private-version",
      documentId: "private-document",
      fileName: "private.pdf",
      storagePath: "private.pdf",
      mimeType: "application/pdf",
    },
  ];
  const prisma = {
    department: { findMany: jest.fn(async () => []) },
    document: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: "own-document",
        createdBy: user.id,
        accessGrants: [],
        latestVersionId,
      })),
    },
    documentVersion: {
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string; documentId?: string } }) => {
          const version = versions.find(
            (v) => v.id === where.id && (!where.documentId || where.documentId === v.documentId),
          );
          if (!version) throw new NotFoundException("Version not found");
          return version;
        },
      ),
    },
  };
  return new DocumentsService(
    prisma as unknown as PrismaService,
    {} as StorageService,
    {} as NotificationsService,
    new ReportAccessService(prisma as unknown as PrismaService),
  );
}

describe("document download boundaries", () => {
  it("downloads a version belonging to the accessible document", async () => {
    expect(await fixture().getFileForDownload("own-document", "own-version", user)).toMatchObject({
      key: "documents/own.pdf",
    });
  });

  it("rejects a version from another document even if the requested document is accessible", async () => {
    await expect(
      fixture().getFileForDownload("own-document", "private-version", user),
    ).rejects.toThrow(NotFoundException);
  });

  it("checks that the latest-version pointer also belongs to the document", async () => {
    await expect(
      fixture("private-version").getFileForDownload("own-document", undefined, user),
    ).rejects.toThrow(NotFoundException);
  });

  it("reports a missing latest version as unavailable", async () => {
    await expect(fixture(null).getFileForDownload("own-document", undefined, user)).rejects.toThrow(
      NotFoundException,
    );
  });
});

function projectDocument(visibility: "department" | "restricted", shared = false) {
  const prisma = {
    department: { findMany: jest.fn(async () => [{ id: "hr", code: "hr" }]) },
    userPermissionOverride: { findUnique: jest.fn(async () => null) },
    resourceAccessGrant: { findMany: jest.fn(async () => []) },
    projectTeamMember: { findFirst: jest.fn(async () => null) },
    report: { findMany: jest.fn(async () => []) },
    project: {
      findMany: jest.fn(async () => []),
      findUniqueOrThrow: jest.fn(async () => ({
        id: "project",
        scope: "department",
        visibility,
        createdBy: "other",
        leadId: null,
        department: { id: "hr", code: "hr" },
      })),
    },
    document: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: "file",
        resourceType: "project",
        resourceId: "project",
        createdBy: "other",
        latestVersion: null,
        accessGrants: shared ? [{ accessType: "user", userId: user.id }] : [],
      })),
    },
    documentVersion: { findMany: jest.fn(async () => []) },
  };
  const service = new DocumentsService(
    prisma as unknown as PrismaService,
    {} as StorageService,
    {} as NotificationsService,
    new ReportAccessService(prisma as unknown as PrismaService),
  );
  return { service, prisma };
}

describe("implicit project document access", () => {
  it("inherits a restricted project's visibility on direct document reads", async () => {
    const { service } = projectDocument("restricted");
    await expect(service.findOne("file", user)).rejects.toThrow(NotFoundException);
  });

  it("does not list versions of a hidden project's file", async () => {
    const { service, prisma } = projectDocument("restricted");
    await expect(service.listVersions("file", user)).rejects.toThrow(NotFoundException);
    expect(prisma.documentVersion.findMany).not.toHaveBeenCalled();
  });

  it("allows ordinary department project documents", async () => {
    await expect(
      projectDocument("department").service.findOne("file", user),
    ).resolves.toMatchObject({ id: "file" });
  });

  it("preserves a document explicitly shared with the reader", async () => {
    await expect(
      projectDocument("restricted", true).service.findOne("file", user),
    ).resolves.toMatchObject({ id: "file" });
  });
});

describe("task and report attachments", () => {
  it("hides a task file when its project is private and the reader is not assigned", async () => {
    const { prisma } = projectDocument("restricted");
    prisma.document.findUniqueOrThrow.mockResolvedValue({
      id: "file",
      resourceType: "task",
      resourceId: "task",
      createdBy: "other",
      latestVersion: null,
      accessGrants: [],
    });
    const taskPrisma = {
      ...prisma,
      task: {
        findMany: jest.fn(async () => [{ id: "task", projectId: "project" }]),
        findUniqueOrThrow: jest.fn(async () => ({ assigneeId: "other", projectId: "project" })),
      },
    };
    const service = new DocumentsService(
      taskPrisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      {} as ReportAccessService,
    );
    await expect(service.findOne("file", user)).rejects.toThrow(NotFoundException);
  });

  it("lets the task assignee read its supporting file", async () => {
    const { prisma } = projectDocument("restricted");
    prisma.document.findUniqueOrThrow.mockResolvedValue({
      id: "file",
      resourceType: "task",
      resourceId: "task",
      createdBy: "other",
      latestVersion: null,
      accessGrants: [],
    });
    const taskPrisma = {
      ...prisma,
      task: {
        findMany: jest.fn(async () => [{ id: "task", projectId: "project" }]),
        findUniqueOrThrow: jest.fn(async () => ({ assigneeId: user.id, projectId: "project" })),
      },
    };
    const service = new DocumentsService(
      taskPrisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      {} as ReportAccessService,
    );
    await expect(service.findOne("file", user)).resolves.toMatchObject({ id: "file" });
  });

  it("applies the report's visibility before listing attachment versions", async () => {
    const { prisma } = projectDocument("department");
    prisma.document.findUniqueOrThrow.mockResolvedValue({
      id: "file",
      resourceType: "department_report",
      resourceId: "report",
      createdBy: "other",
      latestVersion: null,
      accessGrants: [],
    });
    const access = {
      loadReadable: jest.fn(async (_id: string, _viewer: AuthenticatedUser) => {
        throw new NotFoundException("Report not found");
      }),
    };
    const service = new DocumentsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      access as unknown as ReportAccessService,
    );
    await expect(service.listVersions("file", user)).rejects.toThrow(NotFoundException);
    expect(access.loadReadable).toHaveBeenCalledWith("report", user);
    expect(prisma.documentVersion.findMany).not.toHaveBeenCalled();
  });
});

describe("department resource attachments", () => {
  it.each([
    "tender",
    "client_request",
    "department",
    "it_system",
    "finance_report",
    "tender_document_library",
  ] as const)("hides a default %s file from unrelated HR staff", async (resourceType) => {
    const { prisma } = projectDocument("department");
    prisma.document.findUniqueOrThrow.mockResolvedValue({
      id: "file",
      resourceType,
      resourceId: "resource",
      createdBy: "other",
      latestVersion: null,
      accessGrants: [],
    });
    const scopedPrisma = {
      ...prisma,
      department: {
        findMany: jest.fn(async () => [
          { id: "hr", code: "hr" },
          { id: "it", code: "it" },
        ]),
        findUniqueOrThrow: jest.fn(async () => ({ id: "it", code: "it" })),
      },
      userPermissionOverride: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
      },
      tender: {
        findUniqueOrThrow: jest.fn(async () => ({
          accountManagerId: "other",
          department: { id: "it", code: "it" },
          resources: [],
        })),
      },
      clientRequest: {
        findUniqueOrThrow: jest.fn(async () => ({
          assignedToId: "other",
          department: { id: "it", code: "it" },
        })),
      },
    };
    const service = new DocumentsService(
      scopedPrisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      {} as ReportAccessService,
    );
    await expect(service.findOne("file", user)).rejects.toThrow(NotFoundException);
  });

  it("preserves an explicit personal document share across departments", async () => {
    const { prisma } = projectDocument("restricted", true);
    prisma.document.findUniqueOrThrow.mockResolvedValue({
      id: "file",
      resourceType: "tender",
      resourceId: "resource",
      createdBy: "other",
      latestVersion: null,
      accessGrants: [{ accessType: "user", userId: user.id }],
    });
    const service = new DocumentsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      {} as ReportAccessService,
    );
    await expect(service.findOne("file", user)).resolves.toMatchObject({ id: "file" });
  });
});

describe("company project file audience", () => {
  function companyFile(member: boolean, resourceType = "project", creator = "someone-else") {
    const doc = {
      id: "file",
      resourceType,
      resourceId: "resource",
      createdBy: creator,
      latestVersion: null,
      accessGrants: [{ accessType: "user", userId: "outsider" }],
    };
    const prisma = {
      department: { findMany: jest.fn(async () => []) },
      document: { findUniqueOrThrow: jest.fn(async () => doc) },
      project: {
        findMany: jest.fn(async () => [
          { id: "project", team: member ? [{ id: "membership" }] : [] },
        ]),
      },
      task: { findMany: jest.fn(async () => [{ id: "resource", projectId: "project" }]) },
      report: { findMany: jest.fn(async () => [{ id: "resource", subjectId: "project" }]) },
      documentVersion: { findMany: jest.fn(async () => []) },
    };
    if (resourceType === "project") doc.resourceId = "project";
    const access = { loadReadable: jest.fn(async () => ({ id: "resource" })) };
    return new DocumentsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      access as unknown as ReportAccessService,
    );
  }

  it.each(["project", "task", "department_report"])(
    "shares a %s file with all current teammates despite legacy private grants",
    async (resourceType) => {
      await expect(companyFile(true, resourceType).findOne("file", user)).resolves.toMatchObject({
        id: "file",
        teamShared: true,
      });
    },
  );

  it.each(["project", "task", "department_report"])(
    "rejects an outsider's explicit grant on a %s file",
    async (resourceType) => {
      await expect(
        companyFile(false, resourceType).findOne("file", { ...user, id: "outsider" }),
      ).rejects.toThrow(NotFoundException);
    },
  );

  it("revokes an uploader's access after they leave the team", async () => {
    await expect(companyFile(false, "project", user.id).listVersions("file", user)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("company file sharing controls", () => {
  function sharingFixture() {
    const prisma = {
      document: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "file",
          resourceType: "project",
          resourceId: "project",
        })),
      },
      project: {
        findUniqueOrThrow: jest.fn(async () => ({ id: "project", scope: "company", leadId: null })),
        findMany: jest.fn(async () => [{ id: "project", team: [{ id: "membership" }] }]),
      },
      projectTeamMember: { findFirst: jest.fn(async () => ({ access: "viewer" })) },
      $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
      documentAccessGrant: {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async (_query: unknown) => ({})),
      },
    };
    const service = new DocumentsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      {} as NotificationsService,
      {} as ReportAccessService,
    );
    return { prisma, service };
  }

  it.each(["user", "department", "everyone"] as const)(
    "rejects a separate %s audience",
    async (accessType) => {
      const { service, prisma } = sharingFixture();
      await expect(
        service.setAccess(
          "file",
          { grants: [{ accessType, userId: "outsider", departmentId: "other" }] },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.documentAccessGrant.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("lets an existing viewer member clear legacy private shares", async () => {
    const { service, prisma } = sharingFixture();
    await expect(service.setAccess("file", { grants: [] }, user)).resolves.toEqual([]);
    expect(prisma.documentAccessGrant.deleteMany).toHaveBeenCalledWith({
      where: { documentId: "file" },
    });
  });
});
