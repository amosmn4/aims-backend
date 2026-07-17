import { IsIn, IsOptional, IsString } from "class-validator";

const RAID_TYPES = ["risk", "issue", "dependency", "assumption"] as const;
const RAID_SEVERITIES = ["low", "medium", "high"] as const;
const RAID_STATUSES = ["open", "accepted", "closed"] as const;

export class CreateRaidEntryDto {
  @IsIn(RAID_TYPES)
  type!: (typeof RAID_TYPES)[number];

  @IsString()
  description!: string;

  @IsOptional()
  @IsIn(RAID_SEVERITIES)
  severity?: (typeof RAID_SEVERITIES)[number];

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsIn(RAID_STATUSES)
  status?: (typeof RAID_STATUSES)[number];

  @IsOptional()
  @IsString()
  mitigation?: string;
}
