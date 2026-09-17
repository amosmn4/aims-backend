import { IsEmail, IsIn, IsOptional, IsString } from "class-validator";

export const LEAD_SOURCES = [
  "website",
  "referral",
  "campaign",
  "event",
  "social",
  "cold_outreach",
  "other",
] as const;

export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "nurturing",
  "converted",
  "lost",
] as const;

export class CreateLeadDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: (typeof LEAD_SOURCES)[number];

  @IsOptional()
  @IsIn(LEAD_STAGES)
  stage?: (typeof LEAD_STAGES)[number];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;
}
