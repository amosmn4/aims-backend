import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import type { DebtorFollowUpType } from "@prisma/client";

const FOLLOW_UP_TYPES: DebtorFollowUpType[] = [
  "reminder_sent",
  "promise_to_pay",
  "escalated",
  "note",
];

export class CreateFollowUpDto {
  // Replies default to a plain note.
  @IsOptional()
  @IsIn(FOLLOW_UP_TYPES)
  type?: DebtorFollowUpType;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsDateString()
  promisedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
