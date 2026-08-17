import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from "class-validator";

export const WATER_METER_TYPES = ["main", "bulk", "household"] as const;

export class CreateMeterDto {
  @IsString()
  meterNumber!: string;

  @IsOptional()
  @IsIn(WATER_METER_TYPES)
  meterType?: (typeof WATER_METER_TYPES)[number];

  // Either points at an already-registered customer, or names a new one to find-or-create —
  // meters are the primary entry point, so registering one is enough to bring a new customer
  // into the system without a separate creation step (see WaterService.createMeter).
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
}
