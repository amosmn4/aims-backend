import { IsIn, IsOptional, IsString } from "class-validator";

export const IT_SYSTEM_TYPES = ["website", "internal_system", "integration"] as const;
export const IT_SYSTEM_STATUSES = ["active", "inactive", "deprecated"] as const;

export class CreateItSystemDto {
  @IsString()
  name!: string;

  @IsIn(IT_SYSTEM_TYPES)
  type!: (typeof IT_SYSTEM_TYPES)[number];

  @IsOptional()
  @IsIn(IT_SYSTEM_STATUSES)
  status?: (typeof IT_SYSTEM_STATUSES)[number];

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
