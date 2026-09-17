export function isSystemAdmin(user: { roles: string[] }): boolean {
  return user.roles.includes("system_admin");
}
