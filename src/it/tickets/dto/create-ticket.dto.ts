import { IsIn, IsOptional, IsString } from "class-validator";

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TICKET_SOURCES = ["internal", "hrms_client"] as const;

export class CreateTicketDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];

  @IsOptional()
  @IsIn(TICKET_SOURCES)
  source?: (typeof TICKET_SOURCES)[number];

  @IsOptional()
  @IsString()
  systemId?: string;

  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}
