import type { AppRole } from "@prisma/client";

export type AuthenticatedUser = {
  id: string;
  email: string;
  roles: AppRole[];
  departmentId: string | null;
  actorId?: string;
};
