import { IsIn, IsOptional, IsString } from "class-validator";

const REQUIREMENT_STATUSES = ["pending", "in_progress", "obtained", "not_applicable"] as const;

export class CreateTenderRequirementDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(REQUIREMENT_STATUSES)
  status?: (typeof REQUIREMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  documentId?: string;
}
