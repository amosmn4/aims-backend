import { IsIn, IsString } from "class-validator";

export const ENGAGEMENT_ANCHOR_TYPES = ["request", "tender", "project", "contract"] as const;

export class ResolveEngagementDto {
  @IsIn(ENGAGEMENT_ANCHOR_TYPES)
  type!: (typeof ENGAGEMENT_ANCHOR_TYPES)[number];

  @IsString()
  id!: string;
}
