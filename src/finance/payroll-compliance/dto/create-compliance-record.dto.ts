import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateComplianceRecordDto {
  @IsString()
  clientId!: string;

  @IsDateString()
  period!: string;

  @IsString()
  filingType!: string;

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
