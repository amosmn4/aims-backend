import { IsOptional, IsString } from "class-validator";

export class GenerateInsightDto {
  // "YYYY-MM" — defaults to the current month when omitted (see WaterService.reportSummary).
  @IsOptional()
  @IsString()
  month?: string;
}
