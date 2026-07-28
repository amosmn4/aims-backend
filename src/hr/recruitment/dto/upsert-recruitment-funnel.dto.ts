import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpsertRecruitmentFunnelDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  applicationsReceived?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  screened?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  interviewed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offered?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  placed?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
