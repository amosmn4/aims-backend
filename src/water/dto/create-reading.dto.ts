import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateReadingDto {
  @IsString()
  meterId!: string;

  @IsDateString()
  readingDate!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  value?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  cumulativeUsage?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  reviewToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reviewReason?: string;

  // null clears the notes on update.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  notes?: string | null;
}
