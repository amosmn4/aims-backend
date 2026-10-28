import { describe, expect, it, jest } from "@jest/globals";
import { AiChatService } from "./ai-chat.service";
import type { AiAssistantService } from "./ai-assistant.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ReportAccessService } from "../reports/report-access.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["water"],
  departmentId: null,
};
function fixture() {
  const db = {
    aiChatMessage: {
      findMany: jest.fn(async (_args: unknown) => []),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const assistant = {
    answer: jest.fn(
      async (_message: string, _user: unknown, _history: unknown, _context: unknown) => ({
        text: "Recorded result",
        sources: [],
        queriedAt: "2026-10-28T00:00:00Z",
      }),
    ),
  };
  const reports = {
    loadReadable: jest.fn(async (_id: string, _user: unknown) => ({
      title: "Historical report",
      periodStart: new Date("2024-01-01"),
      periodEnd: new Date("2024-12-31"),
      figures: { revenue: 100 },
    })),
  };
  const service = new AiChatService(
    db as unknown as PrismaService,
    assistant as unknown as AiAssistantService,
    reports as unknown as ReportAccessService,
  );
  return { service, db, assistant, reports };
}
describe("Assistant date and report context", () => {
  it("leaves a system question unrestricted and persists the live evidence", async () => {
    const { service, assistant, db } = fixture();
    await service.send("All recorded payments", "system", user);
    expect(assistant.answer).toHaveBeenCalledWith("All recorded payments", user, [], undefined);
    expect(db.aiChatMessage.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contextKey: "system",
          role: "assistant",
          evidence: expect.objectContaining({ sources: [] }),
        }),
      }),
    );
  });
  it("uses the selected historical Water month with Nairobi boundaries", async () => {
    const { service, assistant } = fixture();
    await service.send("Explain this report", "water-report:2024-02", user);
    expect(assistant.answer).toHaveBeenCalledWith(
      "Explain this report",
      user,
      [],
      expect.objectContaining({
        month: "2024-02",
        periodStart: new Date("2024-01-31T21:00:00Z"),
        periodEndExclusive: new Date("2024-02-29T21:00:00Z"),
      }),
    );
  });
  it("loads the report through existing access rules and includes its saved figures", async () => {
    const { service, assistant, reports } = fixture();
    await service.send("Explain this report", "report:historical", user);
    expect(reports.loadReadable).toHaveBeenCalledWith("historical", user);
    expect(assistant.answer).toHaveBeenCalledWith(
      "Explain this report",
      user,
      [],
      expect.objectContaining({
        title: "Historical report",
        figures: { revenue: 100 },
        periodStart: new Date("2024-01-01"),
      }),
    );
  });
});
