import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from "class-validator";

export const WATER_METER_TYPES = ["main", "bulk", "household"] as const;
export const WATER_VENDING_SYSTEMS = ["amsol", "mpaya"] as const;

export class CreateMeterDto {
  @IsString()
  meterNumber!: string;

  @IsOptional()
  @IsIn(WATER_METER_TYPES)
  meterType?: (typeof WATER_METER_TYPES)[number];

  // Main/bulk meters: a friendly label and physical location, no customer (see WaterService —
  // customerId/customerName are ignored for these types).
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;

  // Household meters only. Either points at an already-registered customer, or names a new one
  // to find-or-create — meters are the primary entry point, so registering one is enough to bring
  // a new customer into the system without a separate creation step (see WaterService.createMeter).
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  plotNo?: string;

  @IsOptional()
  @IsDateString()
  installedAt?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

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
  replacesMeterId?: string;
}
