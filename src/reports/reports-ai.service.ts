import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { ReportAccessService } from "./report-access.service";
import { formatFigure, readFigures, type ReportFigure } from "./report-figures";
import { readSections, type ReportSection } from "./report-sections";
import type { ReportAssistDto } from "./dto/report.dto";

const SYSTEM = `You help people at Africa Management Solutions write their monthly reports in AIMS.

Rules you must never break:
- Never invent a number. Every figure you mention must be one given to you.
- If you are inferring a cause rather than reading it from the data, say "likely".
- Write plainly, for a business reader, in British English. No jargon, no bullet padding.
- Short paragraphs. Never more than you were asked for.
- You are drafting. The person will edit what you write and it is their report, not yours.`;

const figureLine = (f: ReportFigure) => {
  const now = formatFigure(f);
  if (f.previousValue === null || f.previousValue === undefined) return `${f.label}: ${now}`;
  const before = formatFigure({ ...f, value: f.previousValue });
  return `${f.label}: ${now} (was ${before} the period before)`;
};

/** The AI jobs a report can ask for. Each one is a button somebody pressed. */
@Injectable()
export class ReportsAiService {
  private readonly logger = new Logger(ReportsAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly access: ReportAccessService,
  ) {}

  status() {
    return { configured: this.ai.isConfigured(), providers: this.ai.providerStatus() };
  }

  /** The month across every approved report, for the CEO. Needs no single report. */
  async briefing(user: AuthenticatedUser) {
    this.assertConfigured();
    return this.brief(user);
  }

  async assist(id: string, dto: ReportAssistDto, user: AuthenticatedUser) {
    this.assertConfigured();
    if (dto.job === "brief") return this.brief(user);
    const report = await this.access.loadReadable(id, user);
    const figures = readFigures(report.figures);
    const sections = readSections(report.sections, report.template);

    switch (dto.job) {
      case "draft_narrative":
        return this.draftNarrative(report, figures, sections, dto.target);
      case "explain_change":
        return this.explainChange(report, figures, dto.target);
      case "check":
        return this.check(report, figures, sections);
      default:
        throw new BadRequestException("Choose what you want help with");
    }
  }

  private assertConfigured() {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException("AI help isn't switched on for AIMS yet");
    }
  }

  private async draftNarrative(
    report: { title: string; template: string },
    figures: ReportFigure[],
    sections: ReportSection[],
    target?: string,
  ) {
    const section =
      sections.find((s) => s.id === target) ?? sections.find((s) => s.type === "narrative");
    if (!section) throw new BadRequestException("There is nothing here to draft");
    const lists = sections
      .filter((s) => s.items?.length)
      .map((s) => `${s.title}:\n${s.items!.map((i) => `- ${i.text}`).join("\n")}`)
      .join("\n\n");

    const prompt = `Report: ${report.title}
Section to write: "${section.title}"${section.hint ? ` — ${section.hint}` : ""}

The figures for this period:
${figures.map(figureLine).join("\n")}

${lists ? `What happened:\n${lists}` : ""}

Write that section in two or three short paragraphs. Explain anything that moved a lot, using only the figures above. Return plain text, no heading.`;

    const { text, provider } = await this.complete(prompt, 700);
    return { job: "draft_narrative", sectionId: section.id, text: text.trim(), provider };
  }

  private async explainChange(report: { title: string }, figures: ReportFigure[], target?: string) {
    const figure = figures.find((f) => f.key === target);
    if (!figure) throw new BadRequestException("Choose a figure to explain");
    const prompt = `Report: ${report.title}

The figure in question:
${figureLine(figure)}

Everything else that moved in the same period:
${figures
  .filter((f) => f.key !== figure.key)
  .map(figureLine)
  .join("\n")}

In two or three sentences, say what likely explains the change in "${figure.label}". Use only the figures above. Say "likely" — you are inferring, not reporting.`;

    const { text, provider } = await this.complete(prompt, 300);
    return { job: "explain_change", figureKey: figure.key, text: text.trim(), provider };
  }

  private async check(
    report: { title: string },
    figures: ReportFigure[],
    sections: ReportSection[],
  ) {
    const edited = figures.filter(
      (f) =>
        f.systemValue !== null &&
        f.systemValue !== undefined &&
        String(f.systemValue) !== String(f.value),
    );
    const written = sections
      .filter((s) => s.body?.trim())
      .map((s) => `${s.title}:\n${s.body}`)
      .join("\n\n");

    const prompt = `Report: ${report.title}

The figures:
${figures.map(figureLine).join("\n")}

${
  edited.length
    ? `Figures the writer changed from what AIMS calculated:\n${edited
        .map(
          (f) =>
            `- ${f.label}: AIMS said ${formatFigure({ ...f, value: f.systemValue ?? null })}, the report says ${formatFigure(f)}${f.note ? ` — "${f.note}"` : " — with no reason given"}`,
        )
        .join("\n")}`
    : ""
}

What the writer said:
${written || "(nothing written yet)"}

Check the writing against the figures. Return JSON only:
{"issues":[{"where":"section title or figure name","problem":"one sentence","fix":"one sentence"}]}
Return an empty list if it all holds together. Do not invent problems.`;

    const { text, provider } = await this.complete(prompt, 600, true);
    return { job: "check", issues: this.parseIssues(text), provider };
  }

  private async brief(user: AuthenticatedUser) {
    if (!isAdminOrCeo(user)) {
      throw new BadRequestException("Only the CEO can ask for a briefing");
    }
    const reports = await this.prisma.report.findMany({
      where: { status: "approved", kind: "department" },
      orderBy: { periodEnd: "desc" },
      take: 8,
      include: { department: { select: { name: true } } },
    });
    if (reports.length === 0) {
      throw new BadRequestException("There are no approved reports to brief you on yet");
    }
    const body = reports
      .map((r) => {
        const figures = readFigures(r.figures).map(figureLine).join("\n");
        const sections = readSections(r.sections, r.template)
          .filter((s) => s.body?.trim())
          .map((s) => `${s.title}: ${s.body}`)
          .join("\n");
        return `## ${r.department?.name ?? r.title}\n${figures}\n${sections}`;
      })
      .join("\n\n");

    const prompt = `These are the departments' approved reports.

${body}

Write the CEO a briefing of at most 250 words covering, in this order: what repeats across departments, anything that contradicts, and what is explicitly waiting on a decision. Plain text, no headings.`;

    const { text, provider } = await this.complete(prompt, 700);
    return { job: "brief", text: text.trim(), provider, reports: reports.length };
  }

  private async complete(prompt: string, maxOutputTokens: number, jsonMode = false) {
    try {
      return await this.ai.complete({ system: SYSTEM, prompt, jsonMode, maxOutputTokens });
    } catch (err) {
      this.logger.warn(`Report AI failed: ${err instanceof Error ? err.message : err}`);
      throw new BadGatewayException("The AI provider didn't answer. Try again in a moment.");
    }
  }

  private parseIssues(text: string) {
    const clean = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(clean) as { issues?: unknown };
      if (!Array.isArray(parsed.issues)) return [];
      return parsed.issues.flatMap((i) => {
        if (!i || typeof i !== "object") return [];
        const issue = i as Record<string, unknown>;
        if (typeof issue.problem !== "string") return [];
        return [
          {
            where: typeof issue.where === "string" ? issue.where : "",
            problem: issue.problem,
            fix: typeof issue.fix === "string" ? issue.fix : "",
          },
        ];
      });
    } catch {
      return [];
    }
  }
}
