import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { PrismaService } from "../prisma/prisma.service";
import {
  PaymentLedgerAccessService,
  LEDGER_MODULE_ID,
  LEDGER_RESOURCE,
} from "./payment-ledger-access.service";

const viewer = (roles: AuthenticatedUser["roles"] = ["general_staff"]): AuthenticatedUser => ({
  id: "staff-id",
  email: "staff@example.com",
  departmentId: null,
  roles,
});

describe("Payment ledger module access", () => {
  const grants =
    jest.fn<(args: unknown) => Promise<{ userId?: string; level: "read" | "write" }[]>>();
  const tx = {
    $queryRaw: jest.fn(),
    user: {
      findUniqueOrThrow: jest.fn<() => Promise<{ roles: { role: string }[] }>>(),
    },
    resourceAccessGrant: { deleteMany: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    resourceAccessGrant: { findMany: grants },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  const service = new PaymentLedgerAccessService(prisma);
  beforeEach(() => {
    jest.clearAllMocks();
    grants.mockResolvedValue([]);
  });

  it.each(["ceo", "system_admin"] as const)(
    "gives %s default full access without grants",
    async (role) => {
      expect(await service.access(viewer([role]))).toEqual({
        read: true,
        write: true,
        manageAccess: true,
      });
      expect(grants).not.toHaveBeenCalled();
    },
  );

  it.each(["finance", "water", "general_staff", "department_head"] as const)(
    "does not give %s implicit ledger access",
    async (role) => {
      expect(await service.access(viewer([role]))).toEqual({
        read: false,
        write: false,
        manageAccess: false,
      });
      await expect(service.assert(viewer([role]))).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it("restricts a personal view grant to reading", async () => {
    grants.mockResolvedValue([{ userId: "staff-id", level: "read" }]);
    expect(await service.access(viewer())).toEqual({
      read: true,
      write: false,
      manageAccess: false,
    });
    await expect(service.assert(viewer(), "write")).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants).toHaveBeenCalledWith({
      where: { resourceType: LEDGER_RESOURCE, resourceId: LEDGER_MODULE_ID },
    });
  });

  it("allows a personal manage grant without allowing access administration", async () => {
    grants.mockResolvedValue([{ userId: "staff-id", level: "write" }]);
    expect(await service.access(viewer())).toEqual({
      read: true,
      write: true,
      manageAccess: false,
    });
    await expect(service.people(viewer())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not accept another individual's grant", async () => {
    grants.mockResolvedValue([{ userId: "other-id", level: "write" }]);
    expect((await service.access(viewer())).read).toBe(false);
  });

  it("keeps view-as sessions read only", async () => {
    expect(await service.access({ ...viewer(["ceo"]), actorId: "admin" })).toEqual({
      read: true,
      write: false,
      manageAccess: false,
    });
  });

  it("replaces or revokes personal grants and records the actor", async () => {
    tx.user.findUniqueOrThrow.mockResolvedValue({
      roles: [{ role: "general_staff" }],
    });
    await service.set("person-id", "read", viewer(["ceo"]));
    expect(tx.resourceAccessGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "person-id",
        level: "read",
        createdBy: "staff-id",
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
    tx.resourceAccessGrant.create.mockClear();
    await service.set("person-id", "none", viewer(["system_admin"]));
    expect(tx.resourceAccessGrant.deleteMany).toHaveBeenCalled();
    expect(tx.resourceAccessGrant.create).not.toHaveBeenCalled();
  });

  it("protects the CEO's default access", async () => {
    tx.user.findUniqueOrThrow.mockResolvedValue({ roles: [{ role: "ceo" }] });
    await expect(service.set("person-id", "none", viewer(["system_admin"]))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.resourceAccessGrant.deleteMany).not.toHaveBeenCalled();
  });
});
