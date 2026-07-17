import { IsOptional, IsString } from "class-validator";

export class CreateTemplateItemDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  category?: string;
}
