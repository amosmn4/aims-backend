import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";
import type { DebtorFollowUpType } from "@prisma/client";

const FOLLOW_UP_TYPES: DebtorFollowUpType[] = ["reminder_sent", "promise_to_pay", "escalated"];

export class CreateFollowUpDto {
  @IsIn(FOLLOW_UP_TYPES)
  type!: DebtorFollowUpType;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsDateString()
  promisedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
