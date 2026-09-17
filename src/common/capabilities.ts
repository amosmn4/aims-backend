import type { AppRole } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { isAdminOrCeo } from "./is-admin-or-ceo";

export const CAPABILITIES = [
  { key: "view_department", label: "View their department" },
  { key: "edit_department", label: "Add and edit in their department" },
  { key: "onboard_clients", label: "Onboard won clients" },
  { key: "submit_reports", label: "Submit reports to the CEO" },
  { key: "raise_invoices", label: "Raise invoices and record payments" },
  { key: "manage_tenders", label: "Manage tenders" },
  { key: "log_client_requests", label: "Log and route client requests" },
] as const;
export type Capability = (typeof CAPABILITIES)[number]["key"];

export const DEPARTMENT_ROLES = [
  "finance",
  "hr",
  "it",
  "marketing",
  "tender",
  "operations",
] as const;
export const EDITABLE_ROLES: AppRole[] = [
  ...DEPARTMENT_ROLES,
  "water",
  "department_head",
  "account_manager",
  "general_staff",
];
// Roles whose department-wide rights only apply in the person's own home department.
const HOME_SCOPED: AppRole[] = ["department_head", "account_manager", "general_staff"];

const WRITERS = new Set<AppRole>([...DEPARTMENT_ROLES, "department_head", "account_manager"]);

/** Built-in defaults; they match how AIMS behaved before roles became editable. */
export function defaultCapability(role: AppRole, capability: Capability): boolean {
  switch (capability) {
    case "view_department":
      return WRITERS.has(role) || role === "general_staff";
    case "edit_department":
    case "onboard_clients":
    case "submit_reports":
      return WRITERS.has(role);
    case "raise_invoices":
      return role === "finance";
    case "manage_tenders":
      return role === "tender" || role === "department_head" || role === "account_manager";
    case "log_client_requests":
      return role === "operations" || role === "department_head" || role === "account_manager";
  }
}

let overrides = new Map<string, boolean>();
const key = (role: string, capability: string) => `${role}:${capability}`;

export async function loadCapabilities(prisma: PrismaService) {
  const rows = await prisma.roleCapability.findMany();
  overrides = new Map(rows.map((r) => [key(r.role, r.capability), r.allowed]));
}

export function setCapabilityCache(role: AppRole, capability: Capability, allowed: boolean) {
  overrides.set(key(role, capability), allowed);
}

export function roleCan(role: AppRole, capability: Capability): boolean {
  return overrides.get(key(role, capability)) ?? defaultCapability(role, capability);
}

/** Whether one of the person's roles grants the capability, where department-scoped. */
export function userCan(
  user: { roles: AppRole[]; departmentId: string | null },
  capability: Capability,
  department?: { id: string; code: string },
): boolean {
  if (isAdminOrCeo(user)) return true;
  return user.roles.some(
    (role) => roleCan(role, capability) && (!department || roleAppliesTo(role, user, department)),
  );
}

/** A department role covers its own department; home-scoped roles cover the home department. */
export function roleAppliesTo(
  role: AppRole,
  user: { departmentId: string | null },
  department: { id: string; code: string },
) {
  return (
    role === department.code || (HOME_SCOPED.includes(role) && user.departmentId === department.id)
  );
}

export function matrix() {
  return EDITABLE_ROLES.map((role) => ({
    role,
    capabilities: Object.fromEntries(
      CAPABILITIES.map((c) => [c.key, roleCan(role, c.key)]),
    ) as Record<Capability, boolean>,
  }));
}

/** The capabilities a signed-in person has anywhere (for showing and hiding buttons). */
export function effectiveCapabilities(user: AuthenticatedUser): Capability[] {
  return CAPABILITIES.map((c) => c.key).filter((c) => userCan(user, c));
}
