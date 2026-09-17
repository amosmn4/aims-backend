import { IsDateString, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class CreatePlacementDto {
  @IsString()
  @Length(2, 160, { message: "Enter the person's name" })
  candidateName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  position?: string;

  @IsDateString({}, { message: "Choose the date they were placed" })
  placedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
