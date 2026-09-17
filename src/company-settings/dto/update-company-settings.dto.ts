import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  companyName?: string;

  // A small image as a data URL, or null to remove the logo.
  @IsOptional()
  @Matches(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, {
    message: "Logo must be a PNG, JPG, WEBP or SVG image",
  })
  @MaxLength(700_000, { message: "Logo must be smaller than 500 KB" })
  logoDataUrl?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: "Currency must be a 3-letter code like KES" })
  currencyCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStartMonth?: number;

  @IsOptional()
  @IsIn([
    "Africa/Nairobi",
    "Africa/Kampala",
    "Africa/Dar_es_Salaam",
    "Africa/Kigali",
    "Africa/Lagos",
    "Africa/Johannesburg",
    "Europe/London",
    "UTC",
  ])
  timeZone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  reportDueDay?: number;

  // Who staff contact about access, invites and passwords; shown on the sign-in pages.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supportContactName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== "")
  @IsEmail({}, { message: "Enter a valid email for the support contact" })
  supportContactEmail?: string | null;
}
