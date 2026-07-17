import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

const TEAM_MEMBER_TYPES = ["internal", "external"] as const;

export class CreateTeamMemberDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  name!: string;

  @IsString()
  role!: string;

  @IsOptional()
  @IsIn(TEAM_MEMBER_TYPES)
  type?: (typeof TEAM_MEMBER_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  allocationPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursLogged?: number;
}
