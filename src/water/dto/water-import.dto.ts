import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class ConfirmReadyWaterImportDto {
  @Equals(true)
  approved!: boolean;
}

export class UpdateWaterImportRowDto {
  @IsObject()
  data!: Record<string, unknown>;
}

export class ConfirmWaterImportRowDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  reviewToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reviewReason?: string;
}

export class ConfirmWaterImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ConfirmWaterImportRowDto)
  rows!: ConfirmWaterImportRowDto[];
}
