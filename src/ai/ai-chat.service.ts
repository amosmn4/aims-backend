import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AiAssistantService } from "./ai-assistant.service";
import { ReportAccessService } from "../reports/report-access.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { plainAiText } from "./plain-ai-text";
import { startOfDay } from "../common/date-range";

@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assistant: AiAssistantService,
    private readonly reports: ReportAccessService,
  ) {}

  async history(context: string, user: AuthenticatedUser, page = 1) {
    await this.context(context, user);
    const where = { userId: user.id, contextKey: context };
    const [rows, total] = await Promise.all([
      this.prisma.aiChatMessage.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        skip: (page - 1) * 50,
      }),
      this.prisma.aiChatMessage.count({ where }),
    ]);
    return {
      rows: rows.reverse().map((row) => ({
        ...row,
        content: row.role === "assistant" ? plainAiText(row.content) : row.content,
      })),
      total,
      page,
      nextPage: page * 50 < total ? page + 1 : null,
    };
  }

  async send(message: string, contextKey: string, user: AuthenticatedUser) {
    const context = await this.context(contextKey, user);
    const previous = await this.prisma.aiChatMessage.findMany({
      where: { userId: user.id, contextKey },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 12,
    });
    const result = await this.assistant.answer(
      message.trim(),
      user,
      previous.reverse().map(({ role, content }) => ({ role, content })),
      context,
    );
    const evidence: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify({ sources: result.sources, queriedAt: result.queriedAt }),
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.aiChatMessage.create({
        data: { userId: user.id, contextKey, role: "user", content: message.trim() },
      });
      return tx.aiChatMessage.create({
        data: { userId: user.id, contextKey, role: "assistant", content: result.text, evidence },
      });
    });
  }

  async clear(contextKey: string, user: AuthenticatedUser) {
    await this.context(contextKey, user);
    await this.prisma.aiChatMessage.deleteMany({ where: { userId: user.id, contextKey } });
    return { cleared: true };
  }

  private async context(key: string, user: AuthenticatedUser): Promise<unknown> {
    if (["system", "water"].includes(key)) return undefined;
    if (key.startsWith("report:")) {
      const report = await this.reports.loadReadable(key.slice(7), user);
      return {
        title: report.title,
        kind: report.kind,
        subjectId: report.subjectId,
        departmentId: report.departmentId,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        figures: report.figures,
        sections: report.sections,
        instruction:
          "Explain these report figures using current underlying records in the stated reporting period. Identify differences between this saved snapshot and current records. Broaden dates when the question explicitly asks for a different period.",
      };
    }
    const month = /^water-report:([1-9]\d{3}-(?:0[1-9]|1[0-2]))$/.exec(key)?.[1];
    if (month) {
      if (!user.roles.some((role) => ["water", "ceo", "system_admin"].includes(role)))
        throw new BadRequestException("Water access is required.");
      const [year, number] = month.split("-").map(Number);
      return {
        module: "Water",
        month,
        periodStart: startOfDay(month + "-01"),
        periodEndExclusive: startOfDay(
          new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10),
        ),
        instruction:
          "Explain this month's recorded volumes, payments, expenses and discrepancies using live records. Distinguish purchases from consumption and counter movement. Broaden dates when explicitly asked.",
      };
    }
    throw new BadRequestException("Unknown assistant context.");
  }
}
