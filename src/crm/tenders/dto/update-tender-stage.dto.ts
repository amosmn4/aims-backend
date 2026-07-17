import { IsIn, IsOptional, IsString } from "class-validator";

const TENDER_STAGES = ["identified", "applying", "submitted", "evaluation", "won", "lost", "withdrawn"] as const;

export class UpdateTenderStageDto {
  @IsIn(TENDER_STAGES)
  stage!: (typeof TENDER_STAGES)[number];

  @IsOptional()
  @IsString()
  lostReason?: string;
}
