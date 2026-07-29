import { IsIn, IsOptional, IsString } from "class-validator";

const TENDER_STAGES = ["identified", "applying", "submitted", "evaluation", "won", "lost", "withdrawn"] as const;

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
}
