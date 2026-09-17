import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class RecordUptimeDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "Choose the month, like 2026-08" })
  month!: string;

  @IsNumber()
  @Min(0, { message: "Uptime can't be below 0%" })
  @Max(100, { message: "Uptime can't be above 100%" })
  uptimePercent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
