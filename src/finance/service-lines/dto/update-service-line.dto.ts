import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsOptional } from "class-validator";
import { CreateServiceLineDto } from "./create-service-line.dto";

export class UpdateServiceLineDto extends PartialType(CreateServiceLineDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
