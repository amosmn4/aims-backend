import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export const WATER_METER_TYPES = ["main", "bulk", "household"] as const;
export const WATER_VENDING_SYSTEMS = ["amsol", "mpaya"] as const;

// Optional fields accept null on update to clear the stored value.
export class CreateMeterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  meterNumber!: string;

  @IsOptional()
  @IsIn(WATER_METER_TYPES)
  meterType?: (typeof WATER_METER_TYPES)[number];

  // Main/bulk meters: a friendly label and physical location, no customer (see WaterService —
  // customerId/customerName are ignored for these types).
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  location?: string | null;

  // Household meters only. Either points at an already-registered customer, or names a new one
  // to find-or-create — meters are the primary entry point, so registering one is enough to bring
  // a new customer into the system without a separate creation step (see WaterService.createMeter).
  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  plotNo?: string | null;

  @IsOptional()
  @IsDateString()
  installedAt?: string | null;

  @IsOptional()
  @IsString()
  zoneId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(WATER_VENDING_SYSTEMS)
  vendingSystem?: (typeof WATER_VENDING_SYSTEMS)[number];

  // Set when this meter physically replaced another — audit trail only, see WaterMeter schema
  // comment. Optional on both create and update.
  @IsOptional()
  @IsString()
  replacesMeterId?: string | null;
}
