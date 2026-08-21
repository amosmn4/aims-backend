import { IsBoolean, IsOptional } from "class-validator";

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  taskUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  projectUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  financeAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  tenderAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  remindersMeetings?: boolean;

  @IsOptional()
  @IsBoolean()
  emailDigest?: boolean;
}
