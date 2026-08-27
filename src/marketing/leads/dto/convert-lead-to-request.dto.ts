import { IsOptional, IsString } from "class-validator";

// Both optional — leaving them blank preserves the original behavior (an unrouted request that
// Operations/Tender triages later via PATCH client-requests/:id/route).
export class ConvertLeadToRequestDto {
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
