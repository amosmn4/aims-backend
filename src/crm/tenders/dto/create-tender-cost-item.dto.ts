import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTenderCostItemDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}
