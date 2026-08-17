import { IsDateString, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateReadingDto {
  @IsString()
  meterId!: string;

  @IsDateString()
  readingDate!: string;

  @IsNumber()
  value!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
