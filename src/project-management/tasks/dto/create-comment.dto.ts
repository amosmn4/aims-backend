import { IsString, IsOptional, IsUUID } from "class-validator";

export class CreateCommentDto {
  @IsString()
  body!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
