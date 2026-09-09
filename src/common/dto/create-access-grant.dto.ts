import { IsIn, IsOptional, IsString } from "class-validator";

// Shared shape for sharing a single record (Tender, Client Request) with a user or department
// outside its own owning department — see ResourceAccessGrant.
export class CreateAccessGrantDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsIn(["read", "write"])
  level!: "read" | "write";
}
