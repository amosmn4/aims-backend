import { IsOptional, IsString } from "class-validator";

export class UpdateRequirementTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
