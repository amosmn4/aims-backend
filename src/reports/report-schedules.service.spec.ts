import { describe, expect, it, jest } from "@jest/globals";
import { ReportSchedulesService } from "./report-schedules.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { EmailService } from "../notifications/email/email.service";
import type { WaterService } from "../water/water.service";
import type { WaterExpensesService } from "../water/water-expenses.service";

describe("Water monthly email", () => {
  it("uses the shared financial totals with cents and category costs in the subscribed CEO report", async () => {
    const prisma = {
      department: { findMany: jest.fn(async () => []) },
      report: { findMany: jest.fn(async () => []) },
      financeReport: { findMany: jest.fn(async () => []) },
      user: {
        findMany: jest.fn(async (_query: unknown) => [
          {
            email: "ceo@example.test",
            fullName: "CEO",
            reportEmailSubscriptions: [{ enabled: true }],
          },
        ]),
      },
      waterMeter: { count: jest.fn(async () => 10) },
    };
    const water = {
      summary: jest.fn(async (_month: string) => ({
        month: "2026-10",
        unitsSold: 50,
        collections: 1000.01,
        cashAfterExpenses: 914.21,
        expenses: {
          recorded: 80.65,
          paid: 85.8,
          unpaid: 40.4,
          categories: [
            { category: "electricity", recorded: 30.25, paid: 85.8, unpaid: 0, count: 1 },
          ],
        },
      })),
    };
    const email = { send: jest.fn(async (_to: string, _subject: string, _html: string) => true) };
    const service = new ReportSchedulesService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
      email as unknown as EmailService,
      water as unknown as WaterExpensesService,
      {
        householdReconciliation: jest.fn(async () => ({
          reconciliation: {
            metersRead: 10,
            metersTotal: 10,
            openingBalance: 0,
            purchases: 50,
            measuredUsed: 30,
            creditUsed: 30,
            closingBalance: 20,
            difference: 0,
            complete: true,
            estimated: false,
            issues: 0,
          },
        })),
      } as unknown as WaterService,
    );
    await service.sendMonthlyEmails(new Date(2026, 10, 1, 7));
    expect(water.summary).toHaveBeenCalledWith("2026-10");
    const call = email.send.mock.calls.find(([, subject]) => subject.startsWith("Water Project"));
    expect(call?.[2]).toContain("Usage from lifetime counters");
    expect(call?.[2]).toContain("Remaining prepaid units");
    expect(call?.[2]).toContain("Expenses recorded");
    expect(call?.[2]).toContain("KES 80.65");
    expect(call?.[2]).toContain("KES 914.21");
    expect(call?.[2]).toContain("Electricity / pumping");
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, roles: { some: { role: "ceo" } } } }),
    );
  });
});
