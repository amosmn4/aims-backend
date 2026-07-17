import { IsArray, IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import type { AppRole } from "@prisma/client";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  officeId?: string;

  @IsArray()
  roles!: AppRole[];
}
