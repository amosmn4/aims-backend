import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import { CreateProjectDto } from "./dto/create-project.dto";
import { ProjectsService } from "./projects.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { ThreadsService } from "../../threads/threads.service";
import type { DocumentsService } from "../../documents/documents.service";
import type { TimelineExtensionsService } from "../timeline-extensions/timeline-extensions.service";
import type { NotificationsService } from "../../notifications/notifications.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "ceo",
  email: "ceo@example.test",
  roles: ["ceo"],
  departmentId: null,
};
const completedOn = new Date("2026-09-30T09:00:00Z");
const editedOn = new Date("2026-10-08T09:00:00Z");

function fixture(isComplete = false, completedAt: Date | null = null) {
  const milestone = {
    id: "milestone",
    projectId: "project",
    title: "Send shortlist",
    isComplete,
    completedAt,
  };
  const prisma = {
    project: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: "project",
        scope: "department",
        department: { id: "hr", code: "hr" },
      })),
    },
    milestone: {
      findUniqueOrThrow: jest.fn(async () => milestone),
      update: jest.fn(async (input: { data: Record<string, unknown> }) => ({
        ...milestone,
        ...input.data,
      })),
    },
  };
  const service = new ProjectsService(
    {} as ThreadsService,
    prisma as unknown as PrismaService,
    {} as DocumentsService,
    {} as TimelineExtensionsService,
    {} as NotificationsService,
  );
  return { service, prisma };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(editedOn);
});
afterEach(() => {
  jest.useRealTimers();
});

describe("milestone completion dates", () => {
  it("records the date when the milestone is completed", async () => {
    const { service } = fixture();
    expect(
      (await service.updateMilestone("milestone", { isComplete: true }, user)).completedAt,
    ).toEqual(editedOn);
  });

  it("preserves completion dates when the milestone title is edited", async () => {
    const { service } = fixture(true, completedOn);
    expect(
      (await service.updateMilestone("milestone", { title: "Shortlist approved" }, user))
        .completedAt,
    ).toEqual(completedOn);
  });

  it("does not invent a historical date when an unchanged completed status is sent", async () => {
    const { service } = fixture(true);
    expect(
      (await service.updateMilestone("milestone", { isComplete: true }, user)).completedAt,
    ).toBeNull();
  });

  it("clears the completion date when the milestone is reopened", async () => {
    const { service } = fixture(true, completedOn);
    expect(
      (await service.updateMilestone("milestone", { isComplete: false }, user)).completedAt,
    ).toBeNull();
  });
});

const projectReader: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["hr"],
  departmentId: "hr",
};

describe("private project child resources", () => {
  it.each([
    "listMilestones",
    "listDeliverables",
    "getFinancials",
    "listCostItems",
    "listRaci",
    "listRaid",
    "listTeam",
    "listActivities",
  ] as const)("refuses %s to an uninvited department writer", async (method) => {
    const prisma = {
      project: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "private",
          scope: "department",
          visibility: "restricted",
          createdBy: "other",
          department: { id: "hr", code: "hr" },
        })),
      },
      projectTeamMember: { findFirst: jest.fn(async () => null) },
      resourceAccessGrant: { findMany: jest.fn(async () => []) },
      userPermissionOverride: { findUnique: jest.fn(async () => null) },
    };
    const service = new ProjectsService(
      {} as ThreadsService,
      prisma as unknown as PrismaService,
      {} as DocumentsService,
      {} as TimelineExtensionsService,
      {} as NotificationsService,
    );
    await expect(service[method]("private", projectReader)).rejects.toThrow(NotFoundException);
  });
});

describe("company project teams", () => {
  function companyFixture(memberCount = 2) {
    const project = {
      id: "company",
      name: "Expansion",
      scope: "company",
      leadId: "creator",
      department: null,
    };
    const membership = {
      id: "membership",
      projectId: "company",
      userId: "creator",
      access: "lead",
    };
    const team = {
      count: jest.fn(async () => memberCount),
      delete: jest.fn(async (_query: unknown) => membership),
      findUniqueOrThrow: jest.fn(async () => membership),
      findFirst: jest.fn(async (query: { where: { userId: string } }) =>
        query.where.userId === projectReader.id ? { id: "staff-member", access: "viewer" } : null,
      ),
      create: jest.fn(async (query: { data: Record<string, unknown> }) => ({
        id: "new-member",
        ...query.data,
        user: null,
      })),
    };
    const prisma = {
      projectTeamMember: team,
      project: {
        findUniqueOrThrow: jest.fn(async () => project),
        create: jest.fn(async (query: { data: { name: string } }) => ({
          id: "company",
          name: query.data.name,
        })),
      },
      user: {
        findMany: jest.fn(async (_query: unknown) => [
          { id: projectReader.id, fullName: "IT staff", email: projectReader.email },
          { id: "marketing", fullName: "Marketing", email: "marketing@example.test" },
          { id: "operations", fullName: "Operations", email: "operations@example.test" },
        ]),
        findFirst: jest.fn(async () => ({
          fullName: "Marketing",
          email: "marketing@example.test",
        })),
      },
      $transaction: jest.fn(
        async (action: (tx: { projectTeamMember: typeof team }) => Promise<unknown>) =>
          action({ projectTeamMember: team }),
      ),
    };
    const notifier = { notify: jest.fn(async () => undefined) };
    const service = new ProjectsService(
      {} as ThreadsService,
      prisma as unknown as PrismaService,
      {} as DocumentsService,
      {} as TimelineExtensionsService,
      notifier as unknown as NotificationsService,
    );
    return { service, prisma, notifier };
  }

  it("lets ordinary staff create a project across departments with equal team rights", async () => {
    const { service, prisma, notifier } = companyFixture();
    await service.create(
      {
        scope: "company",
        name: "Expansion",
        members: [
          { userId: "marketing", access: "viewer" },
          { userId: "operations", access: "member" },
          { userId: "marketing", access: "member" },
          { userId: projectReader.id },
        ],
      } as CreateProjectDto,
      { ...projectReader, roles: ["general_staff"] },
    );
    const input = prisma.project.create.mock.calls[0][0] as unknown as {
      data: { team: { create: { userId: string; access: string; role: string }[] } };
    };
    expect(input.data.team.create).toEqual([
      expect.objectContaining({ userId: projectReader.id, role: "Member", access: "member" }),
      expect.objectContaining({ userId: "marketing", role: "Member", access: "member" }),
      expect.objectContaining({ userId: "operations", role: "Member", access: "member" }),
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
    expect(notifier.notify).toHaveBeenCalledTimes(2);
  });

  it("rejects inactive or unknown invitees instead of silently dropping them", async () => {
    const { service, prisma } = companyFixture();
    await expect(
      service.create(
        {
          scope: "company",
          name: "Expansion",
          members: [{ userId: "inactive" }],
        } as CreateProjectDto,
        projectReader,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it("lets an existing viewer add colleagues with full membership", async () => {
    const { service, prisma } = companyFixture();
    await service.createTeamMember(
      "company",
      { userId: "marketing", name: "Wrong name", role: "Viewer", access: "viewer" },
      projectReader,
    );
    expect(prisma.projectTeamMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: "company",
          userId: "marketing",
          name: "Marketing",
          role: "Member",
          access: "member",
        },
      }),
    );
  });

  it("lets a teammate remove the original creator", async () => {
    const { service, prisma } = companyFixture();
    await service.deleteTeamMember("membership", projectReader);
    expect(prisma.projectTeamMember.delete).toHaveBeenCalledWith({ where: { id: "membership" } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("preserves the last team member", async () => {
    const { service, prisma } = companyFixture(1);
    await expect(service.deleteTeamMember("membership", projectReader)).rejects.toThrow(
      "at least one person",
    );
    expect(prisma.projectTeamMember.delete).not.toHaveBeenCalled();
  });

  it("refuses team management by an outsider", async () => {
    const { service } = companyFixture();
    await expect(
      service.deleteTeamMember("membership", { ...projectReader, id: "outsider" }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe("company project request validation", () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const metadata = { type: "body" as const, metatype: CreateProjectDto };

  it("accepts the simple form payload with teammate IDs and no access roles", async () => {
    const input = {
      name: "Company rollout",
      scope: "company",
      members: [{ userId: "marketing" }, { userId: "operations" }],
    };
    const result = (await pipe.transform(input, metadata)) as CreateProjectDto;
    expect(result.members?.map((member) => member.userId)).toEqual(["marketing", "operations"]);
  });

  it("keeps historical viewer payloads compatible", async () => {
    await expect(
      pipe.transform(
        { name: "Rollout", scope: "company", members: [{ userId: "marketing", access: "viewer" }] },
        metadata,
      ),
    ).resolves.toBeInstanceOf(CreateProjectDto);
  });

  it("rejects an invalid member access value at the API boundary", async () => {
    await expect(
      pipe.transform(
        { name: "Rollout", scope: "company", members: [{ userId: "marketing", access: "owner" }] },
        metadata,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
