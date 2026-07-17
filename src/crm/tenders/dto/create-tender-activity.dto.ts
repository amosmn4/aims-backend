import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

const ACTIVITY_TYPES = ["note", "call", "email", "meeting"] as const;

export class CreateTenderActivityDto {
  @IsOptional()
  @IsIn(ACTIVITY_TYPES)
  type?: (typeof ACTIVITY_TYPES)[number];

  @IsString()
  @MinLength(1)
  summary!: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;
}
