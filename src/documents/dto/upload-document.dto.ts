import { IsIn, IsOptional, IsString } from "class-validator";

const RESOURCE_TYPES = ["project", "task", "finance_report", "tender", "client_request"] as const;

export class UploadDocumentDto {
  @IsIn(RESOURCE_TYPES)
  resourceType!: (typeof RESOURCE_TYPES)[number];

  @IsString()
  resourceId!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  // Multipart fields arrive as strings — comma-separated, split in the service.
  @IsOptional()
  @IsString()
  tags?: string;
}
