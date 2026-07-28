import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
const DELIVERY_STAGES = ["onboarding", "in_progress", "delivery", "invoicing", "payment", "closed"] as const;
const PROJECT_HEALTHS = ["green", "amber", "red"] as const;
export const SDLC_STAGES = ["requirements", "design", "development", "testing", "deployment", "maintenance"] as const;

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
}
