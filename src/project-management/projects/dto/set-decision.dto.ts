import { IsBoolean } from "class-validator";

export class SetDecisionDto {
  @IsBoolean()
  isDecision!: boolean;
}
