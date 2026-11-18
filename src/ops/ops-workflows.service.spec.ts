import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../prisma/prisma.service";
import type { EmailService } from "../notifications/email/email.service";
import type { StorageService } from "../storage/storage.service";
import { ConfigService } from "@nestjs/config";
import type { OpsService } from "./ops.service";
import type { WeeklyService } from "./weekly/weekly.service";
import type { WeeklyClock } from "./weekly/weekly-clock";
import { OpsWorkflowsService } from "./ops-workflows.service";

jest.mock("../common/sanitize", () => ({
  sanitizeRichText: (value: string) => value,
  stripHtml: (value: string) => value,
}));

describe("Scheduled Ops submissions", () => {
  const now = new Date("2026-11-20T16:00:00Z");
  const updateMany = jest.fn<(...args: unknown[]) => Promise<{ count: number }>>();
  const update = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const findMany = jest.fn<() => Promise<unknown[]>>();
  const findDraft = jest.fn<() => Promise<unknown>>();
  const save = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const send = jest.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true);
  const monthlyWorkspace = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const monthlySave = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({});
  const staff = {
    id: "staff",
    userId: "user",
    name: "Staff",
    title: "Consultant",
    dept: "hr",
    role: "staff",
    active: true,
    user: { email: "staff@example.test", isActive: true },
  };
  const db = {
    opsSubmissionSchedule: { updateMany, update, findMany },
    opsStaff: { findUnique: async () => staff },
    opsWeeklyReport: { findUnique: findDraft },
  } as unknown as PrismaService;
  const config = new ConfigService({
    OPS_EMAIL_JOBS_ENABLED: true,
    OPS_FRONTEND_URL: "https://ops.example.test",
  });
  const service = new OpsWorkflowsService(
    db,
    { workspace: monthlyWorkspace, save: monthlySave } as unknown as OpsService,
    { save } as unknown as WeeklyService,
    { now: () => now } as WeeklyClock,
    { send, isConfigured: () => true } as unknown as EmailService,
    config,
    {} as StorageService,
  );
  const row = {
    id: "schedule",
    staffId: "staff",
    kind: "report",
    target: "2026-11-16",
    runAt: now,
    status: "pending",
    reminderState: "pending",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    updateMany.mockReset();
    findMany.mockReset();
    findDraft.mockReset();
    save.mockResolvedValue({});
    send.mockResolvedValue(true);
  });

  it("submits the latest saved draft once when two workers observe the same due record", async () => {
    findMany.mockResolvedValue([row]);
    findDraft.mockResolvedValue({
      version: 7,
      submittedAt: null,
      submission: { summary: "Latest saved draft" },
    });
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    await service.tick();
    await service.tick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "staff" }),
      "2026-11-16",
      "report",
      { version: 7, submit: true, submission: { summary: "Latest saved draft" } },
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "schedule" },
      data: { status: "completed", leaseUntil: null, lastError: null },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a reminder within the final hour and leaves the draft editable", async () => {
    findMany.mockResolvedValue([{ ...row, runAt: new Date(now.getTime() + 3590000) }]);
    updateMany.mockResolvedValue({ count: 1 });
    await service.tick();
    expect(send).toHaveBeenCalledWith(
      "staff@example.test",
      expect.stringContaining("scheduled"),
      expect.stringContaining("update your saved draft"),
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("submits a monthly draft using its claimed schedule when the staff browser session has ended", async () => {
    findMany.mockResolvedValue([{ ...row, kind: "monthly", target: "monthly-report" }]);
    updateMany.mockResolvedValue({ count: 1 });
    monthlyWorkspace.mockResolvedValue({
      revision: 9,
      workspace: { reports: [{ id: "monthly-report", author: "staff", status: "draft" }] },
    });
    await service.tick();
    expect(monthlyWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "scheduler" }),
      "schedule",
    );
    expect(monthlySave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "staff" }),
      "reports",
      { id: "monthly-report", author: "staff", status: "submitted" },
      9,
      "schedule",
    );
  });

  it("records validation failure without emailing a CEO or marking the draft submitted", async () => {
    findMany.mockResolvedValue([row]);
    findDraft.mockResolvedValue({ version: 3, submittedAt: null, submission: {} });
    updateMany.mockResolvedValue({ count: 1 });
    save.mockRejectedValueOnce(new Error("Add your outcomes"));
    await service.tick();
    expect(update).toHaveBeenCalledWith({
      where: { id: "schedule" },
      data: { status: "failed", leaseUntil: null, lastError: "Add your outcomes" },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
