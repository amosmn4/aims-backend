import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { DeliverableStatus } from "@prisma/client";

export class CreateDeliverableDto {
  @IsString()
  @MaxLength(191)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(DeliverableStatus)
  status?: DeliverableStatus;
}
