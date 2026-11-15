import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { PrismaService } from "../../prisma/prisma.service";
import { OpsLedgerAccessService } from "./ops-ledger-access.service";

const user: AuthenticatedUser = {
  id: "legacy-id",
  email: "owner@example.test",
  roles: ["ceo", "system_admin"],
  departmentId: null,
};
type Staff = {
  active: boolean;
  role: string;
  user: { isActive: boolean };
  moduleGrants: { access: "view" | "manage" }[];
};
const findUnique = jest.fn<(args: unknown) => Promise<Staff | null>>();
const service = new OpsLedgerAccessService({
  opsStaff: { findUnique },
} as unknown as PrismaService);
beforeEach(() => {
  findUnique.mockReset();
});
describe("Ops Ledger access", () => {
  it("requires explicit grants even for legacy administrators and Ops CEOs", async () => {
    findUnique.mockResolvedValue({
      active: true,
      role: "ceo",
      user: { isActive: true },
      moduleGrants: [],
    });
    expect(await service.access(user)).toEqual({ read: false, write: false, manageAccess: true });
    await expect(service.assert(user)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(["view", "manage"] as const)(
    "resolves %s from the linked Ops account",
    async (access) => {
      findUnique.mockResolvedValue({
        active: true,
        role: "staff",
        user: { isActive: true },
        moduleGrants: [{ access }],
      });
      expect(await service.access(user)).toEqual({
        read: true,
        write: access === "manage",
        manageAccess: false,
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "legacy-id" } }),
      );
    },
  );
  it.each([
    null,
    { active: false, role: "ceo", user: { isActive: true }, moduleGrants: [{ access: "manage" }] },
    { active: true, role: "ceo", user: { isActive: false }, moduleGrants: [{ access: "manage" }] },
  ] as const)("denies missing or inactive profiles", async (staff) => {
    findUnique.mockResolvedValue(staff as Staff | null);
    expect(await service.access(user)).toEqual({ read: false, write: false, manageAccess: false });
  });
  it("denies impersonated sessions and prevents legacy grant administration", async () => {
    findUnique.mockResolvedValue({
      active: true,
      role: "ceo",
      user: { isActive: true },
      moduleGrants: [{ access: "manage" }],
    });
    expect((await service.access({ ...user, actorId: "actor" })).read).toBe(false);
    await expect(service.people()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.set()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
