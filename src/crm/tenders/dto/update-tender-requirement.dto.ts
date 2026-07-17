import { IsIn, IsOptional, IsString } from "class-validator";

const REQUIREMENT_STATUSES = ["pending", "in_progress", "obtained", "not_applicable"] as const;

export class UpdateTenderRequirementDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(REQUIREMENT_STATUSES)
  status?: (typeof REQUIREMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  notes?: string;

  // Explicit null clears the link (Document already attached elsewhere); undefined leaves it
  // untouched — plain @IsOptional() alone can't distinguish "don't change" from "unlink".
  @IsOptional()
  documentId?: string | null;
}
