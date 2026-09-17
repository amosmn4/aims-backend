import { PartialType } from "@nestjs/mapped-types";
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from "class-validator";

export const EXPENSE_CATEGORIES = [
  "salaries",
  "rent",
  "utilities",
  "software",
  "travel",
  "marketing",
  "subcontractors",
  "equipment",
  "professional_fees",
  "taxes",
  "other",
] as const;

export class CreateExpenseDto {
  @IsDateString()
  expenseDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  supplier?: string;

  @IsString()
  @Length(2, 190, { message: "Describe the expense in a few words" })
  description!: string;

  @IsIn(EXPENSE_CATEGORIES, { message: "Choose a category" })
  category!: (typeof EXPENSE_CATEGORIES)[number];

  @IsNumber()
  @Min(0.01, { message: "Enter an amount greater than zero" })
  amount!: number;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  serviceLineId?: string | null;

  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsOptional()
  @IsDateString()
  paidOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class PayExpenseDto {
  @IsDateString()
  paidOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
