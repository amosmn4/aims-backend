import { PartialType } from "@nestjs/mapped-types";
import { Transform } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { WaterExpenseCategory } from "@prisma/client";

export const WATER_EXPENSE_CATEGORIES: WaterExpenseCategory[] = [
  "electricity",
  "maintenance",
  "repairs",
  "equipment",
  "staff",
  "other",
];

export const WATER_EXPENSE_CATEGORY_LABELS: Record<WaterExpenseCategory, string> = {
  electricity: "Electricity / pumping",
  maintenance: "Maintenance",
  repairs: "Repairs",
  equipment: "Equipment",
  staff: "Staff costs",
  other: "Other",
};

export class CreateWaterExpenseDto {
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Choose an expense date" })
  expenseDate!: string;

  @IsIn(WATER_EXPENSE_CATEGORIES)
  category!: WaterExpenseCategory;

  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(2, 190)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Choose a payment date" })
  paidOn?: string | null;
}

export class UpdateWaterExpenseDto extends PartialType(CreateWaterExpenseDto, {
  skipNullProperties: false,
}) {}

export class PayWaterExpenseDto {
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Choose a payment date" })
  paidOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
