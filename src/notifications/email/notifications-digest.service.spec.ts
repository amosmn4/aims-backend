import { describe, expect, it, jest } from "@jest/globals";
import { NotificationsDigestService } from "./notifications-digest.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { EmailService } from "./email.service";

describe("Notification digest after Ops reporting cutover", () => {
  it("excludes obsolete reporting alerts and keeps unrelated task emails", async () => {
    const findMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([
      {
        userId: "staff",
        type: "task_assigned",
        title: "New task",
        body: "Assigned work",
        user: { email: "staff@example.test", fullName: "Staff" },
      },
    ]);
    const send = jest.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true);
    const db = {
      notification: { findMany },
      notificationPreference: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      },
      notificationChannelPreference: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new NotificationsDigestService(db, {
      isConfigured: () => true,
      send,
    } as unknown as EmailService);
    await expect(service.runDigest()).resolves.toMatchObject({ sent: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isRead: false,
          type: { notIn: ["report_due", "report_submitted", "report_reviewed", "report_comment"] },
        },
      }),
    );
    expect(send).toHaveBeenCalledWith(
      "staff@example.test",
      expect.any(String),
      expect.stringContaining("New task"),
    );
  });
});
