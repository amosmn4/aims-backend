import { isSystemAdmin } from "./is-system-admin";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

type UserRef = { fullName: string | null; email: string; roles: { role: string }[] };

export const PLATFORM_NAME = "AIMS";

/** Display-safe user reference; the query must select `roles: { select: { role: true } }`. */
export function maskUserRef<T extends UserRef>(
  user: T,
  viewer: AuthenticatedUser,
): Omit<T, "roles"> {
  const { roles, ...rest } = user;
  if (roles.some((r) => r.role === "system_admin") && !isSystemAdmin(viewer)) {
    return { ...rest, fullName: PLATFORM_NAME, email: "" };
  }
  return rest;
}
