import { isSystemAdmin } from "./is-system-admin";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

type UserRef = { fullName: string | null; email: string; roles: { role: string }[] };

/**
 * Strips a system admin's identity from an embedded user reference (task comment author,
 * tender resource/time-entry assignee, account manager, etc.) before it reaches any viewer
 * who isn't a system admin themselves. Requires the query to select `roles: { select: { role
 * : true } }` alongside the usual fullName/email so this can tell whether the referenced user
 * is an admin — that extra field is stripped from the returned shape either way.
 */
export function maskUserRef<T extends UserRef>(user: T, viewer: AuthenticatedUser): Omit<T, "roles"> {
  const { roles, ...rest } = user;
  const targetIsAdmin = roles.some((r) => r.role === "system_admin");
  if (targetIsAdmin && !isSystemAdmin(viewer)) {
    return { ...rest, fullName: null, email: "" };
  }
  return rest;
}
