import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreateOfficeDto {
  @IsString()
  name!: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsBoolean()
  isHq?: boolean;
}
