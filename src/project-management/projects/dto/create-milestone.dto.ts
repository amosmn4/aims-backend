import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateMilestoneDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  dueDate!: string;
}
