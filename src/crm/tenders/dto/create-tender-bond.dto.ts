import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

const BOND_TYPES = ["bid_bond", "performance_bond", "other"] as const;
const BOND_STATUSES = ["pending", "lodged", "released", "forfeited"] as const;

export class CreateTenderBondDto {
  @IsIn(BOND_TYPES)
  bondType!: (typeof BOND_TYPES)[number];

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsIn(BOND_STATUSES)
  status?: (typeof BOND_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  issuedDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
