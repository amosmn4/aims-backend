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
  const update = jest
    .fn<(...args: unknown[]) => Promise<object>>()
    .mockImplementation(async (query) => {
      Object.assign(task, (query as { data: object }).data);
      return task;
    });
  const createTask = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const notify = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const planUpdate = jest
    .fn<(...args: unknown[]) => Promise<{ count: number }>>()
    .mockResolvedValue({ count: 1 });
  const findRecipients = jest
    .fn<(...args: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([{ id: recipientId, name: "Recipient" }]);
  const db = {
    opsTaskDelegation: {
      findMany: async () => (request?.status === "pending" ? [structuredClone(request)] : []),
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
    opsTask: { update, create: createTask },
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
    {
      save: async (_db: unknown, _collection: string, value: typeof task) => {
        data.tasks = [...data.tasks.filter((row) => row.id !== value.id), value as never];
        return value;
      },
    } as never,
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
    createTask,
    notify,
    planUpdate,
    findRecipients,
    request: () => request,
  };
}

describe("Task delegation acceptance", () => {
  it("rejects a draft source that reuses another staff member's task identifier with different casing", async () => {
    const { service, task, create } = fixture();
    task.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    task.assignee = recipientId;
    const source = {
      ...task,
      id: task.id.toUpperCase(),
      assignee: senderId,
      description:
        '<ul data-type="taskList"><li data-type="taskItem" data-did="part" data-checked="false"><div><p>References</p></div></li></ul>',
    };
    await expect(
      service.delegateTask(
        sender,
        source.id,
        { assignee: recipientId, deliverableId: "part", source },
        1,
      ),
    ).rejects.toThrow("not found");
    expect(create).not.toHaveBeenCalled();
    expect(task.assignee).toBe(recipientId);
  });
  it("offers one deliverable from a new draft without publishing or replacing the saved weekly plan", async () => {
    const { service, task, data, request, planUpdate } = fixture();
    const source = {
      ...task,
      id: "10000000-0000-4000-8000-000000000005",
      description:
        '<ul data-type="taskList"><li data-type="taskItem" data-did="selected" data-checked="false"><div><p>References</p></div></li><li data-type="taskItem" data-did="other" data-status="forwarded" data-target-date="2026-12-04" data-checked="false"><div><p>Other draft work</p></div></li></ul>',
    };
    await service.delegateTask(
      sender,
      source.id,
      { assignee: recipientId, deliverableId: "selected", source },
      1,
    );
    const saved = data.tasks.find((row) => row.id === source.id)!;
    expect(saved.description).toContain("References");
    expect(saved.description).not.toContain("Other draft work");
    expect(saved.requiresDeliverables).toBe(true);
    expect(saved.assignee).toBe(senderId);
    expect(request()).toMatchObject({
      status: "pending",
      taskId: source.id,
      deliverableId: "selected",
    });
    expect(planUpdate).not.toHaveBeenCalled();
  });
  it("delegates only the selected deliverable after acceptance and leaves the parent with its sender", async () => {
    const { service, task, createTask, request, planUpdate } = fixture();
    const row = (id: string, title: string) =>
      `<li data-type="taskItem" data-did="${id}" data-status="blocked" data-checked="false"><div><p>${title}</p><ul><li>Keep nested instructions</li></ul></div></li>`;
    task.description = `<ul data-type="taskList">${row("one", "References")}${row("two", "Approval")}</ul>`;
    task.status = "Done";
    await service.delegateTask(sender, taskId, { assignee: recipientId, deliverableId: "one" }, 1);
    expect(request()).toMatchObject({
      deliverableId: "one",
      deliverableTitle: "References",
      pendingTaskId: null,
      pendingDeliverableKey: `${taskId}:one`,
    });
    expect(createTask).not.toHaveBeenCalled();
    expect(task.description).not.toContain('data-status="delegated"');
    await service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 2);
    expect(task.assignee).toBe(senderId);
    expect(task.status).toBe("Done");
    expect(task.description).toContain('data-status="delegated"');
    const target = (createTask.mock.calls[0]![0] as { data: { description: string } }).data;
    expect(target).toMatchObject({
      id: requestId,
      assignee: recipientId,
      status: "To do",
      requiresDeliverables: true,
    });
    expect(target.description).toContain("References");
    expect(target.description).toContain("Keep nested instructions");
    expect(target.description).not.toContain("Approval");
    expect(planUpdate).toHaveBeenCalled();
    await service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 3);
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it("protects pending deliverables from overlapping requests and acceptance after their content changes", async () => {
    const { service, task, createTask } = fixture();
    task.description =
      '<ul data-type="taskList"><li data-type="taskItem" data-did="one" data-checked="false"><div><p>References</p></div></li></ul>';
    await service.delegateTask(sender, taskId, { assignee: recipientId, deliverableId: "one" }, 1);
    await expect(
      service.delegateTask(sender, taskId, { assignee: recipientId, deliverableId: "one" }, 2),
    ).rejects.toThrow("pending");
    task.description = task.description.replace("References", "Changed instructions");
    await expect(
      service.respondToDelegation(recipient, requestId, { decision: "accepted" }, 2),
    ).rejects.toThrow("sender changed");
    expect(createTask).not.toHaveBeenCalled();
  });
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
