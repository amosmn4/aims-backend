import { IsIn, IsString } from "class-validator";

const ACTIONS = ["read", "write"] as const;
const EFFECTS = ["grant", "deny", "clear"] as const;

export class SetOverrideDto {
  @IsString()
  userId!: string;

  @IsString()
  departmentId!: string;

  @IsIn(ACTIONS)
  action!: "read" | "write";

  // "clear" removes the override, reverting the user to their role's default for this action.
  @IsIn(EFFECTS)
  effect!: "grant" | "deny" | "clear";
}
