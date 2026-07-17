import { IsDateString } from "class-validator";

export class MarkFiledDto {
  @IsDateString()
  filedDate!: string;
}
