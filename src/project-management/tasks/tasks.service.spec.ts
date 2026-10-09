import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TasksService } from "./tasks.service";
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

function fixture(status = "in_progress", completedAt: Date | null = null) {
  const project = { id: "project", scope: "department", department: { id: "hr", code: "hr" } };
  const task = {
    id: "task",
    projectId: "project",
    title: "Screen applications",
    status,
    completedAt,
    assigneeId: null,
    dueDate: null,
    project,
  };
  const prisma = {
    project: { findUniqueOrThrow: jest.fn(async () => project) },
    task: {
      findUniqueOrThrow: jest.fn(async () => task),
      create: jest.fn(async (input: { data: Record<string, unknown> }) => ({
        ...task,
        ...input.data,
      })),
      update: jest.fn(async (input: { data: Record<string, unknown> }) => ({
        ...task,
        ...input.data,
      })),
    },
  };
  const service = new TasksService(
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

describe("task completion dates", () => {
  it("records a date when a task is created already completed", async () => {
    const { service } = fixture();
    const task = await service.create(
      { projectId: "project", title: "Screen applications", status: "completed" },
      user,
    );
    expect(task.completedAt).toEqual(editedOn);
  });

  it("records the transition to completed", async () => {
    const { service } = fixture();
    const task = await service.update("task", { status: "completed" }, user);
    expect(task.completedAt).toEqual(editedOn);
  });

  it("preserves the original completion date when completed work is edited", async () => {
    const { service, prisma } = fixture("completed", completedOn);
    const task = await service.update(
      "task",
      { description: "Client confirmed the shortlist" },
      user,
    );
    expect(task.completedAt).toEqual(completedOn);
    expect(prisma.task.update.mock.calls[0][0].data).not.toHaveProperty("completedAt");
  });

  it("does not replace a completion date when the same status is sent again", async () => {
    const { service } = fixture("completed", completedOn);
    expect((await service.update("task", { status: "completed" }, user)).completedAt).toEqual(
      completedOn,
    );
  });

  it("keeps unknown historical completion dates unknown", async () => {
    const { service } = fixture("completed");
    expect((await service.update("task", { status: "completed" }, user)).completedAt).toBeNull();
  });

  it("clears the date when a completed task is reopened", async () => {
    const { service } = fixture("completed", completedOn);
    expect((await service.update("task", { status: "in_progress" }, user)).completedAt).toBeNull();
  });
});

describe("company task access", () => {
  it("revokes an assigned task when its assignee leaves the company project team", async () => {
    const prisma = {
      task: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "task",
          assigneeId: user.id,
          project: { id: "company", scope: "company", leadId: user.id },
        })),
      },
      projectTeamMember: { findFirst: jest.fn(async () => null) },
    };
    const service = new TasksService(
      {} as ThreadsService,
      prisma as unknown as PrismaService,
      {} as DocumentsService,
      {} as TimelineExtensionsService,
      {} as NotificationsService,
    );
    await expect(service.findOne("task", { ...user, roles: ["it"] })).rejects.toThrow(
      "Task not found",
    );
  });
});
