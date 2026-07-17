import { IsIn, IsOptional, IsString } from "class-validator";

const BILLING_FREQUENCIES = ["one_off", "monthly", "quarterly", "annual"] as const;

export class ConvertTenderToProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  contractNumber?: string;

  @IsOptional()
  @IsIn(BILLING_FREQUENCIES)
  billingFrequency?: (typeof BILLING_FREQUENCIES)[number];
}
