import { IsIn, IsOptional, IsString } from "class-validator";

const RESOURCE_TYPES = [
  "project",
  "task",
  "finance_report",
  "department_report",
  "tender",
  "client_request",
  "tender_document_library",
  "department",
  "it_system",
] as const;

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

  // JSON-encoded `AccessGrantInput[]` (see SetAccessGrantsDto) — lets the upload form set access
  // in the same request instead of a mandatory separate "Sharing" step afterwards. Parsed and
  // validated in DocumentsService.upload(); omitted/empty means "everyone" (unchanged default).
  @IsOptional()
  @IsString()
  access?: string;
}
