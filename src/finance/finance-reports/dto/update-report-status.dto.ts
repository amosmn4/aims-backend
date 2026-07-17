import { IsIn, IsOptional, IsString } from "class-validator";
import type { FinanceReportStatus } from "@prisma/client";

const REPORT_STATUSES: FinanceReportStatus[] = [
  "draft",
  "submitted",
  "approved",
  "changes_requested",
];

export class UpdateReportStatusDto {
  @IsIn(REPORT_STATUSES)
  status!: FinanceReportStatus;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
