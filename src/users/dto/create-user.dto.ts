import { IsArray, IsEmail, IsOptional, IsString } from "class-validator";
import type { AppRole } from "@prisma/client";

export class CreateUserDto {
  @IsEmail()
  email!: string;

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
