import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateReadingDto {
  @IsString()
  meterId!: string;

  @IsDateString()
  readingDate!: string;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  cumulativeUsage?: number | null;

  // null clears the notes on update.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  notes?: string | null;
}
