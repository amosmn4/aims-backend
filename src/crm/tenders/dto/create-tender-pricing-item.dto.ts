import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTenderPricingItemDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
