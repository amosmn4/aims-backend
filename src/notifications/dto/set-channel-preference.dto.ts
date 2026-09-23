import { IsBoolean, IsDateString, IsOptional, IsString, ValidateIf } from "class-validator";

export class SetChannelPreferenceDto {
  @IsString()
  eventKey!: string;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  // The bell itself. Off means AIMS doesn't raise this kind of alert at all.
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  // Pause this kind of alert until a date; null starts them again now.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  mutedUntil?: string | null;
}

/** Pauses every kind of alert at once, or starts them all again. */
export class MuteAllDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  mutedUntil?: string | null;
}
