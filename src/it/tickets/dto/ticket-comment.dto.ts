import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class TicketCommentDto {
  @IsString()
  @MinLength(1, { message: "Write a message first" })
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
