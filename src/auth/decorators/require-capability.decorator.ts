import { SetMetadata } from "@nestjs/common";
import type { Capability } from "../../common/capabilities";

export const CAPABILITY_KEY = "requiredCapability";
export const RequireCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);

/** On a read route: people who can view this department may read even without the capability. */
export const DEPARTMENT_VIEWERS_KEY = "departmentViewers";
export const AlsoForDepartmentViewers = (departmentCode: string) =>
  SetMetadata(DEPARTMENT_VIEWERS_KEY, departmentCode);
