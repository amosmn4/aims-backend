import { PartialType } from "@nestjs/mapped-types";
import { IsOptional, IsString } from "class-validator";
import { AllowHtml } from "../../../common/sanitize";
import { CreateBlogPostDto } from "./create-blog-post.dto";

export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto) {
  // Redeclared: PartialType doesn't carry the @AllowHtml marker over.
  @AllowHtml()
  @IsOptional()
  @IsString()
  content?: string;
}
