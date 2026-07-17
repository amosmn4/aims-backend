import { IsOptional, IsString } from "class-validator";

export class SaveAsTemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
