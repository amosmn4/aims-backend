import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
const DELIVERY_STAGES = [
  "onboarding",
  "in_progress",
  "delivery",
  "invoicing",
  "payment",
  "closed",
] as const;
const PROJECT_HEALTHS = ["green", "amber", "red"] as const;
const PROJECT_VISIBILITIES = ["department", "restricted"] as const;
const PROJECT_ENGAGEMENT_TYPES = ["one_off", "ongoing"] as const;
const EXTENSION_ATTRIBUTIONS = ["client", "internal", "third_party", "other"] as const;
export const SDLC_STAGES = [
  "requirements",
  "design",
  "development",
  "testing",
  "deployment",
  "maintenance",
] as const;

export class CreateProjectDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsString()
  departmentId!: string;

  // Must be one of the project department's own service lines.
  @IsOptional()
  @IsString()
  serviceLineId?: string;

  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: (typeof PROJECT_STATUSES)[number];

  @IsOptional()
  @IsIn(DELIVERY_STAGES)
  deliveryStage?: (typeof DELIVERY_STAGES)[number];

  @IsOptional()
  @IsString()
  methodology?: string;

  // Only meaningful when methodology === "system_development" — a standard SDLC stepper.
  @IsOptional()
  @IsIn(SDLC_STAGES)
  sdlcStage?: (typeof SDLC_STAGES)[number];

  @IsOptional()
  @IsIn(PROJECT_HEALTHS)
  health?: (typeof PROJECT_HEALTHS)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(PROJECT_VISIBILITIES)
  visibility?: (typeof PROJECT_VISIBILITIES)[number];

  // Users to grant access to when visibility is "restricted" — additive only (creates missing
  // ProjectTeamMember rows), never removes existing ones. Not a Project column itself, so both
  // `create`/`update` in ProjectsService pull it out of the dto before writing to Prisma.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];

  // "one_off" (default): a bounded delivery. "ongoing": retainer/maintenance work with no
  // natural end — excluded from the "project overdue" notification sweep.
  @IsOptional()
  @IsIn(PROJECT_ENGAGEMENT_TYPES)
  engagementType?: (typeof PROJECT_ENGAGEMENT_TYPES)[number];

  // Only meaningful together with a later `endDate` — see ProjectsService.update. Not Project
  // columns; pulled out of the dto before writing, same as memberIds.
  @IsOptional()
  @IsString()
  extensionReason?: string;

  @IsOptional()
  @IsIn(EXTENSION_ATTRIBUTIONS)
  extensionAttribution?: (typeof EXTENSION_ATTRIBUTIONS)[number];
}
