import { IsIn, IsInt, IsString, Min, ValidateIf } from "class-validator";

const ENGAGEMENT_TYPES = ["view", "like", "share", "time_spent"] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

// One endpoint for every engagement signal the site reports — `type` picks which counter moves,
// so the website deals with a single POST shape instead of four separate routes.
export class RecordEngagementDto {
  @IsString()
  slug!: string;

  @IsIn(ENGAGEMENT_TYPES)
  type!: EngagementType;

  // Only meaningful (and required) when type is "time_spent" — how long the reader had the post
  // open, in seconds.
  @ValidateIf((dto: RecordEngagementDto) => dto.type === "time_spent")
  @IsInt()
  @Min(0)
  seconds?: number;
}

// Re-exported so the service doesn't need its own copy of the same literal list.
export { ENGAGEMENT_TYPES };
