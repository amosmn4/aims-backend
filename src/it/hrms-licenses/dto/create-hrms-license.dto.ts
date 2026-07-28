import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export const HRMS_LICENSE_TIERS = ["starter", "growth", "enterprise"] as const;
export const HRMS_LICENSE_STATUSES = ["active", "trial", "suspended", "cancelled"] as const;

export class CreateHrmsLicenseDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsIn(HRMS_LICENSE_TIERS)
  tier?: (typeof HRMS_LICENSE_TIERS)[number];

  @IsOptional()
  @IsIn(HRMS_LICENSE_STATUSES)
  status?: (typeof HRMS_LICENSE_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  activeUsers?: number;

  @IsOptional()
  @IsString()
  renewalDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
