import { IsDateString, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTimeEntryDto {
  @IsDateString()
  entryDate!: string;

  @IsNumber()
  @Min(0.25)
  hours!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
