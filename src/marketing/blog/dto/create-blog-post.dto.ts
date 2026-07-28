import { IsArray, IsOptional, IsString } from "class-validator";

export class CreateBlogPostDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  authorName?: string;
}
