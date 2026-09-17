import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  serviceLineId?: string | null;

  @IsOptional()
  @IsString()
  contractId?: string | null;

  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  directCost?: number;

  @IsOptional()
  @IsIn(["draft", "sent"])
  status?: "draft" | "sent";

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class VoidInvoiceDto {
  @IsString()
  @MinLength(3, { message: "Say why the invoice is being voided" })
  @MaxLength(1000)
  reason!: string;
}
