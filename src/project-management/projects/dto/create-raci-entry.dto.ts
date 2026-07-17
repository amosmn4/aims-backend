import { IsOptional, IsString } from "class-validator";

export class CreateRaciEntryDto {
  @IsString()
  deliverable!: string;

  @IsOptional()
  @IsString()
  responsible?: string;

  @IsOptional()
  @IsString()
  accountable?: string;

  @IsOptional()
  @IsString()
  consulted?: string;

  @IsOptional()
  @IsString()
  informed?: string;
}
