import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  // null clears the value on update.
  @IsOptional()
  @IsString()
  zoneId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  phone?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
