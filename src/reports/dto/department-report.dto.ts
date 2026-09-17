import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ReportFigureDto {
  @IsString()
  @Length(1, 80)
  label!: string;

  @IsString()
  @Length(1, 60)
  value!: string;
}

export const PERIOD_TYPES = ["monthly", "quarterly", "annual", "other"] as const;

export class CreateDepartmentReportDto {
  @IsString()
  departmentId!: string;

  @IsString()
  @Length(3, 160)
  title!: string;

  @IsIn(PERIOD_TYPES)
  periodType!: (typeof PERIOD_TYPES)[number];

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  summary?: string;

  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ReportFigureDto)
  figures!: ReportFigureDto[];

  @IsOptional()
  @IsBoolean()
  submit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  note?: string;
}

export class UpdateDepartmentReportDto {
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
  @MaxLength(10_000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ReportFigureDto)
  figures?: ReportFigureDto[];

  @IsOptional()
  @IsBoolean()
  submit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  note?: string;
}

export class ReviewReportDto {
  @IsIn(["approve", "request_changes"])
  decision!: "approve" | "request_changes";

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  note?: string;
}

export class ReportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
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
