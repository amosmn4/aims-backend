import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { FIGURE_FORMATS, FIGURE_SOURCES } from "../report-figures";
import { SECTION_TYPES } from "../report-sections";

export const PERIOD_TYPES = ["monthly", "quarterly", "annual", "other"] as const;
export const REPORT_KINDS = ["department", "project", "individual"] as const;
export const REPORT_TEMPLATES = [
  "department_monthly",
  "project_progress",
  "project_completion",
  "individual_period",
] as const;

export class ReportFigureDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  key?: string;

  @IsString()
  @Length(1, 80)
  label!: string;

  @IsOptional()
  value?: number | string | null;

  @IsOptional()
  @IsIn(FIGURE_FORMATS)
  format?: (typeof FIGURE_FORMATS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(12)
  unit?: string | null;

  @IsOptional()
  @IsIn(FIGURE_SOURCES)
  source?: (typeof FIGURE_SOURCES)[number];

  @IsOptional()
  systemValue?: number | string | null;

  @IsOptional()
  @IsNumber()
  previousValue?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;
}

export class ReportListItemDto {
  @IsString()
  @Length(1, 400)
  text!: string;

  @IsOptional()
  @IsIn(FIGURE_SOURCES)
  source?: (typeof FIGURE_SOURCES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  link?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  when?: string | null;
}

export class ReportSectionDto {
  @IsString()
  @Length(1, 60)
  id!: string;

  @IsIn(SECTION_TYPES)
  type!: (typeof SECTION_TYPES)[number];

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  hint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string | null;

  @IsOptional()
  @IsIn(FIGURE_SOURCES)
  source?: (typeof FIGURE_SOURCES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ReportListItemDto)
  items?: ReportListItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  figureKeys?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

/** Opens a report for a period, pre-filled from what AIMS recorded. */
export class StartReportDto {
  @IsIn(REPORT_KINDS)
  kind!: (typeof REPORT_KINDS)[number];

  @IsOptional()
  @IsIn(REPORT_TEMPLATES)
  template?: (typeof REPORT_TEMPLATES)[number];

  /** The department, project or person. Left out for your own report.  */
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsIn(PERIOD_TYPES)
  periodType?: (typeof PERIOD_TYPES)[number];

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @Length(3, 160)
  title?: string;
}

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  title?: string;

  @IsOptional()
  @IsIn(PERIOD_TYPES)
  periodType?: (typeof PERIOD_TYPES)[number];

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ReportFigureDto)
  figures?: ReportFigureDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ReportSectionDto)
  sections?: ReportSectionDto[];

  @IsOptional()
  @IsBoolean()
  submit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ReviewReportDto {
  @IsIn(["approve", "request_changes"])
  decision!: "approve" | "request_changes";

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class ReportMessageDto {
  @IsString()
  @Length(1, 4000)
  body!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class ReportEmailSubscriptionDto {
  @IsString()
  reportKey!: string;

  @IsBoolean()
  enabled!: boolean;
}

/** What the AI should draft or check on a report. */
export class ReportAssistDto {
  @IsIn(["draft_narrative", "explain_change", "check", "brief"])
  job!: "draft_narrative" | "explain_change" | "check" | "brief";

  /** The section being drafted, or the figure being explained. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  target?: string;
}
