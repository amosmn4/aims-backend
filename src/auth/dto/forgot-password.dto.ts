import { IsEmail } from "class-validator";

export class ForgotPasswordDto {
  @IsEmail({}, { message: "Enter the email you use for AIMS" })
  email!: string;
}
