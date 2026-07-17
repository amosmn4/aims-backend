import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateCostItemDto {
  @IsString()
  category!: string;

  @IsNumber()
  @Min(0)
  budgetedAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  actualAmount?: number;
}
