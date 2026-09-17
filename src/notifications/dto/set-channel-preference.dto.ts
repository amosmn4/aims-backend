import { IsBoolean, IsOptional, IsString } from "class-validator";

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
}
