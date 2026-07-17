import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

const BILLING_FREQUENCIES = ["one_off", "monthly", "quarterly", "annual"] as const;

// Contract requires several fields a Tender doesn't carry (contractNumber, billingFrequency,
// startDate) — those must be supplied explicitly at conversion time; everything else falls
// back to the tender's own values when omitted.
export class ConvertToContractDto {
  @IsString()
  contractNumber!: string;

  @IsIn(BILLING_FREQUENCIES)
  billingFrequency!: (typeof BILLING_FREQUENCIES)[number];

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  serviceLineId?: string;

  @IsOptional()
  @IsString()
  accountManagerId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
