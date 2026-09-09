import type { ResourceAccessLevel } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

// Layers on top of department access, not instead of it — a record explicitly shared with a
// user or their department grants that level even outside its owning department. "write" also
// satisfies a "read" check (a write grant implies read).
export async function hasResourceGrant(
  resourceType: string,
  resourceId: string,
  user: AuthenticatedUser,
  level: ResourceAccessLevel,
  prisma: PrismaService,
): Promise<boolean> {
  const grants = await prisma.resourceAccessGrant.findMany({
    where: { resourceType, resourceId },
  });
  return grants.some((g) => {
    const satisfies = level === "read" || g.level === "write";
    if (!satisfies) return false;
    if (g.userId) return g.userId === user.id;
    if (g.departmentId) return g.departmentId === user.departmentId;
    return false;
  });
}
