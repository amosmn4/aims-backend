import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from "class-validator";
import type { FinanceReportType } from "@prisma/client";

const REPORT_TYPES: FinanceReportType[] = [
  "monthly_financial",
  "debtors_ageing",
  "revenue_service_line",
  "quarterly_executive",
];

export class CreateFinanceReportDto {
  @IsIn(REPORT_TYPES)
  reportType!: FinanceReportType;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  narrative?: string;

  @IsObject()
  snapshot!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
