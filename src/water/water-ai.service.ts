import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { AiService } from "../ai/ai.service";
import { WaterService } from "./water.service";

interface InsightPayload {
  summary: string;
  anomalies: { title: string; detail: string; severity: "low" | "medium" | "high" }[];
  reasons: string[];
}

// Grounds every AI call in the network's real topology, matching WaterService's own shape.
const SYSTEM_CONTEXT = `You are a water-network analyst for Amsol's water utility operations in AIMS.
The network has this shape: a borehole feeds a tank (measured by the "Borehole → Tank" main meter);
the tank feeds the distribution network (measured by the "Tank → Distribution" main meter);
distribution feeds zone bulk meters (a zone can nest inside another zone) and some unzoned
households directly; each zone's bulk meter feeds that zone's own households plus any child
zones. All volumes are in cubic metres (units). "Loss" / non-revenue water (NRW) at any stage is
the gap between what a meter measured flowing in and what was accounted for downstream — it
covers real leakage, unbilled/illegal use, and meter error, and the data given doesn't distinguish
between those causes, so speak in terms of "likely" causes, not certainties.
Only use the figures you are given — never invent a number, zone, or meter not present in the
data. Currency figures are in Kenyan Shillings (KES).`;

@Injectable()
export class WaterAiService {
  private readonly logger = new Logger(WaterAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly water: WaterService,
    private readonly ai: AiService,
  ) {}

  isConfigured(): boolean {
    return this.ai.isConfigured();
  }

  providerStatus() {
    return this.ai.providerStatus();
  }

  latestInsight(month?: string) {
    return this.prisma.waterAiInsight.findFirst({
      where: month ? { month } : {},
      orderBy: { createdAt: "desc" },
    });
  }

  async generateInsight(month: string | undefined, user: AuthenticatedUser) {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        "AI is not configured yet — set OPENAI_API_KEY or GEMINI_API_KEY on the backend.",
      );
    }

    const [summary, trend] = await Promise.all([
      this.water.reportSummary({ month }),
      this.water.trend({ months: 6 }),
    ]);
    const resolvedMonth = summary.month;

    const dataBlock = JSON.stringify({ ...summary, sixMonthTrend: trend }, null, 2);
    const prompt = `Water network data for ${resolvedMonth}:

${dataBlock}

Respond with a JSON object only (no markdown fence), matching exactly this shape:
{"summary": "<2-4 sentence plain-English narrative of this month's trend, referencing the actual numbers>", "anomalies": [{"title": "<short label>", "detail": "<1-2 sentences>", "severity": "low"|"medium"|"high"}], "reasons": ["<likely cause 1>", "<likely cause 2>"]}
List at most 5 real anomalies grounded in the data — an empty array is fine if nothing stands out.
List at most 5 reasons. Do not invent data not present above.`;

    let result;
    try {
      result = await this.ai.complete({
        system: SYSTEM_CONTEXT,
        prompt,
        jsonMode: true,
        maxOutputTokens: 900,
      });
    } catch (err) {
      // Unlike chat, insight generation has no conversation to degrade into — surface an error.
      this.logger.warn(`Insight generation failed: ${err instanceof Error ? err.message : err}`);
      throw new BadGatewayException(
        "The AI provider(s) didn't respond — check the configured API key(s) and try again.",
      );
    }
    const parsed = this.parseInsightPayload(result.text);

    return this.prisma.waterAiInsight.create({
      data: {
        month: resolvedMonth,
        summary: parsed.summary,
        anomalies: parsed.anomalies,
        reasons: parsed.reasons,
        provider: result.provider,
        generatedBy: user.id,
      },
    });
  }

  // Some providers wrap JSON in a ```json fence despite jsonMode — strip it before parsing.
  private parseInsightPayload(text: string): InsightPayload {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    let raw: unknown;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      throw new BadRequestException("The AI response wasn't valid JSON — try generating again.");
    }
    if (typeof raw !== "object" || raw === null) {
      throw new BadRequestException("The AI response was not in the expected format.");
    }
    const obj = raw as Record<string, unknown>;
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    if (!summary) {
      throw new BadRequestException(
        "The AI response was missing a summary — try generating again.",
      );
    }
    const anomalies = Array.isArray(obj.anomalies)
      ? obj.anomalies.filter(
          (a): a is InsightPayload["anomalies"][number] =>
            typeof a === "object" &&
            a !== null &&
            typeof (a as { title?: unknown }).title === "string",
        )
      : [];
    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.filter((r): r is string => typeof r === "string")
      : [];
    return { summary, anomalies, reasons };
  }

  chatHistory(user: AuthenticatedUser) {
    return this.prisma.waterAiChatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
  }

  async chatSend(message: string, user: AuthenticatedUser) {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        "AI is not configured yet — set OPENAI_API_KEY or GEMINI_API_KEY on the backend.",
      );
    }
    const trimmed = message.trim();
    if (!trimmed) throw new BadRequestException("Message can't be empty.");

    // Last 20 turns of this user's own history, oldest-first, as multi-turn context.
    const recent = await this.prisma.waterAiChatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const history = recent.reverse().map((m) => ({ role: m.role, content: m.content }));

    const [summary, trend] = await Promise.all([
      this.water.reportSummary({}),
      this.water.trend({ months: 6 }),
    ]);
    const dataBlock = JSON.stringify({ ...summary, sixMonthTrend: trend }, null, 2);

    await this.prisma.waterAiChatMessage.create({
      data: { userId: user.id, role: "user", content: trimmed },
    });

    const prompt = `Current water network data (context — the question below may or may not be about this data):

${dataBlock}

Question: ${trimmed}`;

    let result;
    try {
      result = await this.ai.complete({
        system: `${SYSTEM_CONTEXT} Answer conversationally and concisely (a few sentences unless the question calls for a list). If something can't be answered from the data given, say so plainly instead of guessing.`,
        history,
        prompt,
        maxOutputTokens: 600,
      });
    } catch {
      // Degrade gracefully within the conversation itself instead of surfacing a raw error.
      return this.prisma.waterAiChatMessage.create({
        data: {
          userId: user.id,
          role: "assistant",
          content:
            "Sorry — I couldn't reach the AI provider just now. Please try again in a moment.",
        },
      });
    }

    return this.prisma.waterAiChatMessage.create({
      data: { userId: user.id, role: "assistant", content: result.text.trim() },
    });
  }

  async clearChat(user: AuthenticatedUser) {
    await this.prisma.waterAiChatMessage.deleteMany({ where: { userId: user.id } });
    return { cleared: true };
  }
}
