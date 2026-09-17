import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateReadingDto {
  @IsString()
  meterId!: string;

  @IsDateString()
  readingDate!: string;

  @IsNumber()
  @Min(0)
  value!: number;

  // null clears the notes on update.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  notes?: string | null;
}
