import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from "class-validator";

const BILLING_FREQUENCIES = ["one_off", "monthly", "quarterly", "annual"] as const;

export class ConvertTenderToProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  // Delivering department; defaults to the tender's current department.
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  // Contracts are optional — only created when explicitly requested.
  @IsOptional()
  @IsBoolean()
  createContract?: boolean;

  @IsOptional()
  @IsString()
  contractNumber?: string;

  @IsOptional()
  @IsIn(BILLING_FREQUENCIES)
  billingFrequency?: (typeof BILLING_FREQUENCIES)[number];
}
