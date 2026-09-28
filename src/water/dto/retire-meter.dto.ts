import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export const WATER_INACTIVE_REASONS = ["replaced", "removed"] as const;

export class RetireMeterDto {
  @IsIn(WATER_INACTIVE_REASONS)
  reason!: (typeof WATER_INACTIVE_REASONS)[number];

  @IsDateString()
  date!: string;

  // Closing reading on the old meter, so its last period is complete.
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalReading?: number;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  note?: string;

  // Replaced only: registers the new meter in the same step.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  newMeterNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  newMeterReading?: number;
}
