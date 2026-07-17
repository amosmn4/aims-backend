import { IsDateString, IsOptional, IsString } from "class-validator";

export class ConvertToProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
