import { describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { PermissionsService } from "./permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const head: AuthenticatedUser = {
  id: "head",
  email: "head@example.test",
  roles: ["department_head"],
  departmentId: "hr",
};

function fixture() {
  const prisma = {
    department: { findUniqueOrThrow: jest.fn(async () => ({ id: "hr", code: "hr", name: "HR" })) },
    user: {
      findMany: jest.fn(async () => [
        {
          id: "ceo",
          fullName: "CEO",
          email: "ceo@example.test",
          departmentId: "hr",
          roles: [{ role: "ceo" }],
        },
      ]),
    },
    userPermissionOverride: {
      findMany: jest.fn(async () => [{ userId: "ceo", action: "read", effect: "deny" }]),
      upsert: jest.fn(async (query: unknown) => query),
    },
  };
  return { prisma, service: new PermissionsService(prisma as unknown as PrismaService) };
}

describe("department permission administration", () => {
  it("limits a head's permission view to their home department", async () => {
    const { service, prisma } = fixture();
    await expect(service.listCapabilities("it", head)).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("refuses cross-department grants by a head", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.setOverride(
        { userId: "staff", departmentId: "it", action: "write", effect: "grant" },
        head,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.userPermissionOverride.upsert).not.toHaveBeenCalled();
  });

  it("shows the CEO's effective access rather than a non-effective deny override", async () => {
    const result = await fixture().service.listCapabilities("hr", head);
    expect(result.staff[0].capabilities).toEqual({
      read: { effective: true, source: "role" },
      write: { effective: true, source: "role" },
    });
  });

  it("records the acting head when an authorized override is saved", async () => {
    const { service, prisma } = fixture();
    await service.setOverride(
      { userId: "staff", departmentId: "hr", action: "write", effect: "grant" },
      head,
    );
    expect(prisma.userPermissionOverride.upsert.mock.calls[0][0]).toMatchObject({
      create: { createdBy: head.id },
      update: { createdBy: head.id },
    });
  });
});
