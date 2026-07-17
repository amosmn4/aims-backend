import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTenderResourceDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  roleNote?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  allocatedHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;
}
