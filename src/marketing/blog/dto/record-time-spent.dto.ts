import { IsInt, Min } from "class-validator";

export class RecordTimeSpentDto {
  @IsInt()
  @Min(0)
  seconds!: number;
}
