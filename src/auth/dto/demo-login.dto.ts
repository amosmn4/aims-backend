import { IsIn } from "class-validator";
import type { DemoRole } from "../demo-users.const";

const DEMO_ROLES: DemoRole[] = ["system_admin", "ceo", "finance"];

export class DemoLoginDto {
  @IsIn(DEMO_ROLES)
  role!: DemoRole;
}
