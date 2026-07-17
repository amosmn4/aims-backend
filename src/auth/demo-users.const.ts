import type { AppRole } from "@prisma/client";

export type DemoRole = Extract<AppRole, "system_admin" | "ceo" | "finance">;

export const DEMO_USERS: Record<DemoRole, { email: string; password: string; fullName: string }> = {
  system_admin: {
    email: "admin@amsol.demo",
    password: "AmsolDemo!2026",
    fullName: "System Administrator",
  },
  ceo: {
    email: "ceo@amsol.demo",
    password: "AmsolDemo!2026",
    fullName: "Chief Executive Officer",
  },
  finance: {
    email: "finance@amsol.demo",
    password: "AmsolDemo!2026",
    fullName: "Finance Manager",
  },
};
