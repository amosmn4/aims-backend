import type { ReportTemplate } from "@prisma/client";
import type { FigureSource } from "./report-figures";

/**
 * A report's body is an ordered list of sections. The template proposes them;
 * the person writing can reorder, skip the optional ones and add their own.
 */
export const SECTION_TYPES = ["figures", "narrative", "list", "risks", "decisions"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface ReportListItem {
  text: string;
  /** Where this line came from: a real record, or the person. */
  source: FigureSource;
  /** Opens the record it was pulled from, e.g. "/it/tickets?ticket=…". */
  link?: string | null;
  when?: string | null;
}

export interface ReportSection {
  id: string;
  type: SectionType;
  title: string;
  /** Says what this section is for, shown above it while writing. */
  hint?: string | null;
  /** Narrative sections only. */
  body?: string | null;
  source?: FigureSource;
  /** List and risks sections only. */
  items?: ReportListItem[];
  /** Figures sections only — which figures belong here, by key. */
  figureKeys?: string[];
  /** A report can't be sent with this one empty. */
  required?: boolean;
}

export interface TemplateSection {
  id: string;
  type: SectionType;
  title: string;
  hint?: string;
  required?: boolean;
}

const FIGURES_FIRST: TemplateSection = {
  id: "figures",
  type: "figures",
  title: "Key figures",
  hint: "AIMS worked these out from the period. Change anything that is wrong and say why.",
};

/** What each kind of report starts with. */
export const TEMPLATES: Record<ReportTemplate, { title: string; sections: TemplateSection[] }> = {
  department_monthly: {
    title: "Monthly report",
    sections: [
      FIGURES_FIRST,
      {
        id: "summary",
        type: "narrative",
        title: "What changed, and why",
        hint: "The month in a few paragraphs. Explain anything that moved a lot.",
        required: true,
      },
      {
        id: "highlights",
        type: "list",
        title: "What we finished",
        hint: "Work that closed in the period. Remove anything not worth the CEO's time.",
      },
      {
        id: "risks",
        type: "risks",
        title: "What is at risk",
        hint: "Anything that could go wrong next month, and what you are doing about it.",
      },
      {
        id: "decisions",
        type: "decisions",
        title: "What I need you to decide",
        hint: "Say plainly what you need from the CEO. Leave empty if nothing.",
      },
    ],
  },
  project_progress: {
    title: "Progress report",
    sections: [
      FIGURES_FIRST,
      {
        id: "summary",
        type: "narrative",
        title: "Where the project has got to",
        hint: "What moved this period, and whether it is where it should be.",
        required: true,
      },
      { id: "done", type: "list", title: "Finished this period" },
      { id: "slipped", type: "list", title: "Missed or pushed back" },
      { id: "risks", type: "risks", title: "Risks and issues still open" },
      { id: "next", type: "narrative", title: "What happens next" },
      {
        id: "decisions",
        type: "decisions",
        title: "What I need decided",
        hint: "More budget, more people, a date moved — say it here.",
      },
    ],
  },
  project_completion: {
    title: "Completion report",
    sections: [
      FIGURES_FIRST,
      {
        id: "summary",
        type: "narrative",
        title: "What was delivered",
        hint: "What the client got, against what was promised.",
        required: true,
      },
      { id: "delivered", type: "list", title: "Deliverables" },
      {
        id: "slippage",
        type: "list",
        title: "Where time was lost, and to whom",
        hint: "AIMS lists every date that moved and the reason recorded at the time.",
      },
      {
        id: "budget",
        type: "narrative",
        title: "Money against budget",
        hint: "Explain any gap between what was budgeted and what was spent.",
      },
      { id: "open", type: "list", title: "Still open at handover" },
      {
        id: "lessons",
        type: "narrative",
        title: "What we would do differently",
        hint: "The part that makes the next project cheaper.",
        required: true,
      },
    ],
  },
  individual_period: {
    title: "My report",
    sections: [
      { ...FIGURES_FIRST, title: "Your month in numbers" },
      {
        id: "done",
        type: "list",
        title: "What I finished",
        hint: "AIMS pulled these from your work. Remove anything not worth saying.",
      },
      {
        id: "carrying",
        type: "narrative",
        title: "What I'm carrying into next month",
        hint: "What is still open, and why.",
        required: true,
      },
      {
        id: "blocked",
        type: "narrative",
        title: "What's in my way",
        hint: "Say what you need, and from whom. Leave empty if nothing.",
      },
    ],
  },
};

/** Builds the empty body a new report starts from. */
export function templateSections(template: ReportTemplate): ReportSection[] {
  return TEMPLATES[template].sections.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    hint: s.hint ?? null,
    required: s.required ?? false,
    ...(s.type === "narrative" || s.type === "decisions"
      ? { body: "", source: "typed" as const }
      : {}),
    ...(s.type === "list" || s.type === "risks" ? { items: [] } : {}),
    ...(s.type === "figures" ? { figureKeys: [] } : {}),
  }));
}

export function readSections(raw: unknown, template: ReportTemplate): ReportSection[] {
  if (!Array.isArray(raw) || raw.length === 0) return templateSections(template);
  return raw.flatMap((s): ReportSection[] => {
    if (!s || typeof s !== "object") return [];
    const sec = s as Partial<ReportSection>;
    if (!sec.id || !SECTION_TYPES.includes(sec.type as SectionType)) return [];
    return [
      {
        id: sec.id,
        type: sec.type as SectionType,
        title: typeof sec.title === "string" ? sec.title : sec.id,
        hint: sec.hint ?? null,
        body: sec.body ?? null,
        source: sec.source ?? "typed",
        items: Array.isArray(sec.items) ? sec.items : undefined,
        figureKeys: Array.isArray(sec.figureKeys) ? sec.figureKeys : undefined,
        required: sec.required ?? false,
      },
    ];
  });
}

/** The required sections a person has not filled in yet. */
export function missingSections(sections: ReportSection[]): string[] {
  return sections
    .filter((s) => {
      if (!s.required) return false;
      if (s.type === "list" || s.type === "risks") return (s.items?.length ?? 0) === 0;
      return !s.body || s.body.trim().length === 0;
    })
    .map((s) => s.title);
}
