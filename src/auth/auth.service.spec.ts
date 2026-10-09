import { describe, expect, it, jest } from "@jest/globals";
import { AuthService } from "./auth.service";
import { canWriteModule } from "../common/module-access";
import { effectiveCapabilities } from "../common/capabilities";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import type { AuthenticatedUser } from "./types/authenticated-user";

function fixture(role: "tender" | "general_staff", effect?: "grant" | "deny") {
  const user: AuthenticatedUser = {
    id: "staff",
    email: "staff@example.test",
    roles: [role],
    departmentId: "tender-id",
  };
  const departments = [
    { id: "tender-id", code: "tender" },
    { id: "operations-id", code: "operations" },
  ];
  const overrides = effect ? [{ departmentId: "tender-id", action: "write", effect }] : [];
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        ...user,
        roles: user.roles.map((role) => ({ role })),
        passwordHash: "hidden",
      })),
    },
    department: {
      findMany: jest.fn(async () => departments),
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        departments.find((d) => d.code === where.code),
      ),
    },
    userPermissionOverride: {
      findMany: jest.fn(async () => overrides),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { userId_departmentId_action: { departmentId: string; action: string } };
        }) =>
          overrides.find(
            (o) =>
              o.departmentId === where.userId_departmentId_action.departmentId &&
              o.action === where.userId_departmentId_action.action,
          ) ?? null,
      ),
    },
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as JwtService,
    {} as ConfigService,
  );
  return { user, prisma, service };
}

describe("department module decisions", () => {
  it("applies the existing tender write grant without granting Operations access", async () => {
    const { user, prisma } = fixture("general_staff", "grant");
    expect(await canWriteModule("tender", user, prisma as unknown as PrismaService)).toBe(true);
    expect(await canWriteModule("operations", user, prisma as unknown as PrismaService)).toBe(
      false,
    );
  });

  it("lets an explicit deny override the Tender role", async () => {
    const { user, prisma } = fixture("tender", "deny");
    expect(await canWriteModule("tender", user, prisma as unknown as PrismaService)).toBe(false);
  });

  it("keeps read-only home staff from managing bids", async () => {
    const { user, prisma } = fixture("general_staff");
    expect(await canWriteModule("tender", user, prisma as unknown as PrismaService)).toBe(false);
  });

  it("does not add billing or publishing capabilities for a department write grant", async () => {
    const { user, service } = fixture("general_staff", "grant");
    const profile = await service.getProfile(user);
    expect(profile.capabilities).toEqual(effectiveCapabilities(user));
    expect(profile.capabilities).not.toContain("raise_invoices");
    expect(profile.capabilities).not.toContain("publish_blog");
    expect(profile).not.toHaveProperty("passwordHash");
    expect(profile.moduleWriteAccess).toEqual({ tender: true, operations: false });
    expect(profile.departmentAccess).toEqual({ read: ["tender"], write: ["tender"] });
  });
});
