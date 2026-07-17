import { IsIn, IsOptional, IsString } from "class-validator";

const STAGES = ["new", "assigned", "engaging", "proposal", "won", "lost", "withdrawn"] as const;

export class UpdateClientRequestStageDto {
  @IsIn(STAGES)
  stage!: (typeof STAGES)[number];

  @IsOptional()
  @IsString()
  lostReason?: string;
}
