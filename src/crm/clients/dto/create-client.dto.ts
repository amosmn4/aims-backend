import { IsBoolean, IsOptional, IsString, IsEmail } from "class-validator";

export class CreateClientDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  segment?: string;

  @IsOptional()
  @IsString()
  accountManagerId?: string;

  @IsOptional()
  @IsEmail({}, { message: "Enter a valid email address" })
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  // Capturing department — keeps the client visible to that department before any contract exists.
  @IsOptional()
  @IsString()
  departmentId?: string;
}
