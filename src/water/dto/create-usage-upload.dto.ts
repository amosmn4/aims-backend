import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

// Parsed client-side (CSV/Excel via the same `xlsx` library the Finance upload page already
// uses) and posted as JSON — matching how the reference dashboard prototype previews rows before
// confirming, rather than re-parsing the raw file server-side.
export class UsageUploadRowInput {
  @IsString()
  meterNumber!: string;

  @IsString()
  customerName!: string;

  @IsNumber()
  @Min(0)
  unitsSold!: number;

  @IsNumber()
  @Min(0)
  amountPaid!: number;

  @IsDateString()
  recordedAt!: string;
}

export class CreateUsageUploadDto {
  @IsString()
  fileName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => UsageUploadRowInput)
  rows!: UsageUploadRowInput[];
}
