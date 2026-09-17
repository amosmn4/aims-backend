import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateZoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  // null clears the parent, making this a top-level zone.
  @IsOptional()
  @IsString()
  parentZoneId?: string | null;
}
