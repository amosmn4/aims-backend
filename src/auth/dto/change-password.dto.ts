import { IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: "The new password needs at least 8 characters" })
  newPassword!: string;
}
