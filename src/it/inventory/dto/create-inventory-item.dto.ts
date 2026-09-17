import { IsDateString, IsIn, IsOptional, IsString, IsNumber, IsInt, Min } from "class-validator";

export const INVENTORY_CATEGORIES = [
  "laptop",
  "desktop",
  "monitor",
  "printer",
  "peripheral",
  "other",
] as const;

export const INVENTORY_STATUSES = [
  "in_use",
  "idle",
  "in_storage",
  "under_repair",
  "retired",
] as const;

export const INVENTORY_CONDITIONS = ["good", "working", "needs_attention", "faulty"] as const;

export class CreateInventoryItemDto {
  @IsString()
  assetTag!: string;

  @IsString()
  deviceName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(INVENTORY_CATEGORIES)
  category!: (typeof INVENTORY_CATEGORIES)[number];

  @IsOptional()
  @IsIn(INVENTORY_STATUSES)
  status?: (typeof INVENTORY_STATUSES)[number];

  @IsOptional()
  @IsIn(INVENTORY_CONDITIONS)
  condition?: (typeof INVENTORY_CONDITIONS)[number];

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  officeId?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsDateString()
  warrantyExpiry?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchaseCost?: number | null;

  // Months over which the asset loses its value (e.g. 36 for a laptop).
  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number | null;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  assignedUserId?: string | null;
}
