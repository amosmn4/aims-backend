import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";

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
}
