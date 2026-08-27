import { IsIn, IsOptional, IsString } from "class-validator";

const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;

export class CreateLeadActivityDto {
  @IsOptional()
  @IsIn(ACTIVITY_TYPES)
  type?: (typeof ACTIVITY_TYPES)[number];

  @IsString()
  summary!: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;
}
