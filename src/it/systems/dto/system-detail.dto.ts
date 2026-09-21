import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export const SDLC_STEPS = [
  "requirements",
  "design",
  "development",
  "testing",
  "deployment",
  "maintenance",
] as const;
export const STAGE_STATUSES = ["not_started", "in_progress", "done"] as const;
export const FEATURE_STATUSES = ["planned", "building", "live", "dropped"] as const;

/** What was decided and done at one step of building a system. */
export class UpdateSystemStageDto {
  @IsOptional()
  @IsIn(STAGE_STATUSES)
  status?: (typeof STAGE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @IsDateString()
  startedAt?: string | null;

  @IsOptional()
  @IsDateString()
  doneAt?: string | null;
}

export class CreateSystemFeatureDto {
  @IsString()
  @MinLength(2, { message: "Give the feature a name" })
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsIn(FEATURE_STATUSES)
  status?: (typeof FEATURE_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSystemFeatureDto extends CreateSystemFeatureDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  declare title: string;
}

/** The extra detail a system or site carries beyond its name and status. */
export class SystemDetailDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  purpose?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Type(() => String)
  techStack?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Type(() => String)
  tools?: string[];

  @IsOptional()
  @IsUrl({}, { message: "Enter a full web address, like https://example.com" })
  repoUrl?: string | null;

  @IsOptional()
  @IsUrl({}, { message: "Enter a full web address, like https://example.com" })
  docsUrl?: string | null;

  @IsOptional()
  @IsUrl({}, { message: "Enter a full web address, like https://example.com" })
  liveUrl?: string | null;

  @IsOptional()
  @IsIn(SDLC_STEPS)
  currentStage?: (typeof SDLC_STEPS)[number] | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent?: number | null;
}
