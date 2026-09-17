import { IsIn, IsOptional, IsString } from "class-validator";

const TENDER_STAGES = [
  "identified",
  "applying",
  "submitted",
  "won",
  "lost",
  "withdrawn",
  "cancelled",
] as const;

export class UpdateTenderStageDto {
  @IsIn(TENDER_STAGES)
  stage!: (typeof TENDER_STAGES)[number];

  @IsOptional()
  @IsString()
  lostReason?: string;

  // Lets the awarded date be backdated (e.g. entering a tender that was actually won last week)
  // instead of always stamping "now" — only read when stage is being set to "won".
  @IsOptional()
  @IsString()
  wonAt?: string;

  // Why the bid was won, captured when marking it awarded.
  @IsOptional()
  @IsString()
  wonReason?: string;
}
