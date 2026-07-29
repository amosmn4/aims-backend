import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

const SOURCES = ["operations", "marketing", "referral", "website", "other"] as const;

export class CreateClientRequestDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  // Set instead of clientId when the company isn't a real Client record yet — mirrors Tender's
  // prospectClientName; no Client row is created until conversion.
  @IsOptional()
  @IsString()
  prospectClientName?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(SOURCES)
  source?: (typeof SOURCES)[number];

  @IsOptional()
  @IsString()
  serviceLineId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  // Lets intake (Operations, or a lead conversion) assign a department directly instead of
  // always requiring the separate PATCH :id/route step — see ClientRequestsService.create.
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
