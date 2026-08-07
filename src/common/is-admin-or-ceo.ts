/**
 * The one broad-visibility check ("sees everything, not just their own") shared by every
 * personal-scoping filter in the app — CEO and system_admin see company-wide by default,
 * everyone else sees only what's theirs unless a resource has been explicitly shared with them.
 */
export function isAdminOrCeo(user: { roles: string[] }): boolean {
  return user.roles.includes("system_admin") || user.roles.includes("ceo");
}
