import { IsIn, IsOptional } from "class-validator";

const CATEGORIES = [
  "signed",
  "amendment",
  "invoice",
  "proposal",
  "correspondence",
  "other",
] as const;

export class UploadDocumentDto {
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];
}
