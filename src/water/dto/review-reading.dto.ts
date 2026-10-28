import { IsOptional, IsString } from "class-validator";
import { CreateReadingDto } from "./create-reading.dto";

export class ReviewReadingDto extends CreateReadingDto {
  @IsOptional()
  @IsString()
  excludeId?: string;
}
