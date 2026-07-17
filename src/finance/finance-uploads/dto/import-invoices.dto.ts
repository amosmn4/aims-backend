import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class ImportInvoiceRowDto {
  @IsString()
  invoiceNumber!: string;

  @IsString()
  clientName!: string;

  @IsOptional()
  @IsString()
  serviceLineCode?: string;

  @IsString()
  issueDate!: string;

  @IsString()
  dueDate!: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsNumber()
  subtotal!: number;

  @IsNumber()
  tax!: number;

  @IsNumber()
  directCost!: number;

  @IsBoolean()
  isRecurring!: boolean;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImportInvoicesDto {
  @IsString()
  fileName!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportInvoiceRowDto)
  rows!: ImportInvoiceRowDto[];
}
