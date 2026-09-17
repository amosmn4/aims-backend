import { IsBoolean, IsInt, IsOptional, IsString, IsNumber, Min } from "class-validator";

export class CreateServiceLineDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  departmentId!: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // Monthly revenue target in the company currency; null clears it.
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyTarget?: number | null;
}
