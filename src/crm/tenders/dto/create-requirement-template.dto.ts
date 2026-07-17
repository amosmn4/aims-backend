import { ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class RequirementTemplateItemInput {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class CreateRequirementTemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RequirementTemplateItemInput)
  items?: RequirementTemplateItemInput[];
}
