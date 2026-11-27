import { describe, expect, it, jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { OpsService } from "./ops.service";
import type { OpsTransaction } from "./ops.repository";
import type { Viewer, Workspace } from "./ops.schemas";
import { weeklySubmissionSchema } from "./weekly/weekly.schemas";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const senderId = "10000000-0000-4000-8000-000000000001";
const recipientId = "10000000-0000-4000-8000-000000000002";
const taskId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const sender = {
  id: senderId,
  userId: senderId,
  name: "Sender",
  role: "staff",
  dept: "hr",
} as Viewer;
const recipient = { ...sender, id: recipientId, userId: recipientId, name: "Recipient" };

function fixture() {
  let request: Record<string, unknown> | null = null;
  const task = {
    id: taskId,
    title: "Follow up",
    description: "<p>Keep instructions</p>",
    project: "",
    assignee: senderId,
    business: "b0",
    weekStart: "2026-11-16",
    due: "2026-11-20",
    status: "In progress",
    priority: "High",
    subtasks: [],
  };
  const data = {
    tasks: [task],
    projects: [],
    businessAccess: [],
    staffBusiness: [],
  } as unknown as Workspace;
  const create = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockImplementation(async (query) => {
      request = { id: requestId, status: "pending", ...(query as { data: object }).data };
      return structuredClone(request);
    });
  const update = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const notify = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const planUpdate = jest
    .fn<(...args: unknown[]) => Promise<{ count: number }>>()
    .mockResolvedValue({ count: 1 });
  const findRecipients = jest
    .fn<(...args: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([{ id: recipientId, name: "Recipient" }]);
  const db = {
    opsTaskDelegation: {
      findUnique: async () => (request ? structuredClone(request) : null),
      create,
      updateMany: async (query: { data: object }) => {
        request = { ...request, ...query.data };
        return { count: 1 };
      },
    },
    opsStaff: {
      findMany: findRecipients,
      findUnique: async ({ where }: { where: { id: string } }) => ({
        ...(where.id === senderId ? sender : recipient),
        active: true,
        user: { id: where.id, isActive: true },
      }),
    },
    opsTask: { update },
    opsWeeklyReport: {
      findUnique: async (query: {
        where: { staffId_weekStart_phase: { staffId: string; phase: string } };
      }) =>
        query.where.staffId_weekStart_phase.staffId === recipientId &&
        query.where.staffId_weekStart_phase.phase === "plan"
          ? {
              id: "recipient-plan",
              version: 1,
              weekStart: "2026-11-23",
              submittedAt: null,
              submission: weeklySubmissionSchema.parse({ items: [] }),
            }
          : null,
      updateMany: planUpdate,
    },
    notification: { create: notify },
    auditLog: { create: async () => ({}) },
  };
  const service = new OpsService(
    db as never,
    {} as never,
    new ConfigService({ NODE_ENV: "test", OPS_WEEKLY_TEST_NOW: "2026-11-27T10:00:00Z" }),
    {} as never,
    {} as never,
  );
  service.workspace = async () => ({ workspace: data, revision: 1 });
  service.mutate = async <T>(
    _viewer: Viewer,
    _revision: number,
    action: (db: OpsTransaction, data: Workspace) => Promise<T>,
  ) => action(db as unknown as OpsTransaction, data);
  return {
    service,
    task,
    data,
    create,
    update,
    notify,
    planUpdate,
    findRecipients,
    request: () => request,
  };
}

describe("Task delegation acceptance", () => {
  it("lists active staff by business and project without requiring access to other accounts", async () => {
    const { service, task, findRecipients } = fixture();
    task.project = "project";
    task.business = "restricted";
    await expect(service.delegationRecipients(sender, taskId)).resolves.toEqual([
      { id: recipientId, name: "Recipient" },
    ]);
    expect(findRecipients).toHaveBeenCalledWith({
      where: {
        id: { not: senderId },
        role: "staff",
        active: true,
        user: { isActive: true },
        memberships: { some: { projectId: "project" } },
        businessGrants: { some: { businessId: "restricted" } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    await expect(service.delegationRecipients(recipient, taskId)).rejects.toThrow("not found");
    await expect(service.delegationRecipients({ ...sender, role: "ceo" }, taskId)).rejects.toThrow(
      "Staff access",
    );
  });
  it("keeps ownership with the sender until acceptance and notifies the recipient", async () => {
    const { service, update, notify, request } = fixture();
    await expect(
      service.delegateTask(sender, taskId, { assignee: recipientId }, 1),
    ).resolves.toMatchObject({ status: "pending" });
    expect(update).not.toHaveBeenCalled();
    expect(request()).toMatchObject({ senderId, recipientId, pendingTaskId: taskId });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resourceType: "ops-delegation", userId: recipientId }),
      }),
    );
  });

  it("accepts once, adds the existing task to the recipient plan and preserves instructions", async () => {
    const { service, update, planUpdate, request, notify } = fixture();
    await service.delegateTask(sender, taskId, { assignee: recipientId }, 1);
    await service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 2);
    await service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { assignee: recipientId, weekStart: "2026-11-23" },
    });
    expect(planUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          submission: expect.objectContaining({
            items: [
              expect.objectContaining({
                taskId,
                detail: "<p>Keep instructions</p>",
                priority: "High",
              }),
            ],
          }),
        }),
      }),
    );
    expect(request()).toMatchObject({ status: "accepted", pendingTaskId: null });
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: senderId, resourceType: "ops-delegation" }),
      }),
    );
  });

  it.each(["declined", "cancelled"] as const)(
    "leaves ownership unchanged when %s",
    async (decision) => {
      const { service, update, request } = fixture();
      await service.delegateTask(sender, taskId, { assignee: recipientId }, 1);
      await service.respondToDelegation(
        decision === "cancelled" ? sender : recipient,
        requestId,
        { decision },
        2,
      );
      expect(update).not.toHaveBeenCalled();
      expect(request()).toMatchObject({ status: decision, pendingTaskId: null });
    },
  );

  it("rejects duplicate requests, unrelated recipients and acceptance after task ownership changes", async () => {
    const { service, task, update } = fixture();
    await service.delegateTask(sender, taskId, { assignee: recipientId }, 1);
    await expect(
      service.delegateTask(sender, taskId, { assignee: recipientId }, 2),
    ).rejects.toThrow("pending");
    await expect(
      service.respondToDelegation(sender, requestId, { decision: "accepted" }, 2),
    ).rejects.toThrow("not found");
    task.assignee = "another-owner";
    await expect(
      service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 2),
    ).rejects.toThrow("changed");
    expect(update).not.toHaveBeenCalled();
  });

  it("requires current project membership on acceptance", async () => {
    const { service, task, data, update } = fixture();
    await service.delegateTask(sender, taskId, { assignee: recipientId }, 1);
    task.project = "project";
    data.projects = [];
    await expect(
      service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 2),
    ).rejects.toThrow("access");
    expect(update).not.toHaveBeenCalled();
  });
});
