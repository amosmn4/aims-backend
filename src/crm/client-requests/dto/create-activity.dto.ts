import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";

const ACTIVITY_TYPES = ["note", "call", "email", "meeting"] as const;

export class CreateActivityDto {
  @IsOptional()
  @IsIn(ACTIVITY_TYPES)
  type?: (typeof ACTIVITY_TYPES)[number];

  @IsString()
  summary!: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
