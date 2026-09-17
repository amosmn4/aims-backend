import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";

// Only editable while a report is a draft or has changes requested.
export class UpdateFinanceReportDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  narrative?: string;

  @IsOptional()
  @IsObject()
  snapshot?: Record<string, unknown>;

  // Save and send back to the CEO in one step.
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
