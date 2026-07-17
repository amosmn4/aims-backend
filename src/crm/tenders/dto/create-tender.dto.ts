import { IsDateString, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTenderDto {
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  // Set instead of clientId when the target company isn't a real Client record yet — no
  // Client row is created; converting a won tender to a Contract still requires a real clientId.
  @IsOptional()
  @IsString()
  prospectClientName?: string;

  @IsString()
  departmentId!: string;

  @IsOptional()
  @IsString()
  serviceLineId?: string;

  @IsOptional()
  @IsString()
  accountManagerId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  submissionDeadline?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
