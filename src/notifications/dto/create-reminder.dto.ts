import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

const REMINDER_TYPES = ["meeting", "reminder"] as const;

export class CreateReminderDto {
  @IsOptional()
  @IsString()
  userId?: string; // defaults to self when omitted — see NotificationsService.createReminder

  @IsIn(REMINDER_TYPES)
  type!: (typeof REMINDER_TYPES)[number];

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;
}
