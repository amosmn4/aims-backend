import { IsArray, IsOptional, IsString } from "class-validator";
import { AllowHtml } from "../../../common/sanitize";

export class CreateBlogPostDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  // Rich text: sanitized against the editor allowlist in BlogService, not stripped.
  @AllowHtml()
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
