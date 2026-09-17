import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import type { AppRole } from "@prisma/client";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  officeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  roles?: AppRole[];

  @IsOptional()
  @ValidateIf((_, v) => v !== "" && v !== null)
  @Matches(/^\+?[\d\s()-]{9,20}$/, {
    message: "Enter a phone number like 0712 345 678 or +254 712 345 678",
  })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string | null;
}
