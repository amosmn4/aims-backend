import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Enter your full name" })
  @MaxLength(120)
  fullName?: string;

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
