import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export const WATER_ADJUSTMENT_KINDS = ["line_fill", "flushing", "burst_repair", "other"] as const;

/** Water that left the network for a reason someone can name. */
export class CreateAdjustmentDto {
  // Left out when it applies to the whole network rather than one zone.
  @IsOptional()
  @IsString()
  zoneId?: string | null;

  @IsDateString()
  occurredAt!: string;

  @IsNumber()
  @Min(0)
  units!: number;

  @IsOptional()
  @IsIn(WATER_ADJUSTMENT_KINDS)
  kind?: (typeof WATER_ADJUSTMENT_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
