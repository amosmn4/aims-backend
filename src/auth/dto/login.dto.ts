import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail({}, { message: "Please enter a valid email address" })
  email!: string;

  @IsString({ message: "Please enter your password" })
  @MinLength(6, { message: "Please enter your password" })
  password!: string;
}
