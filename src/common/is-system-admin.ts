/**
 * System administrators must never be visible to any other user (CEO included) anywhere in
 * the app, except to another system administrator. This is the single check every visibility
 * filter/mask in this codebase should call, so the rule stays consistent everywhere it's applied.
 */
export function isSystemAdmin(user: { roles: string[] }): boolean {
  return user.roles.includes("system_admin");
}
