import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { bootstrapOps } from "./ops-bootstrap";
import { localAdminConfig, setupLocalOpsAdmin } from "./ops-local-admin";

jest.mock("./ops-bootstrap", () => ({ bootstrapOps: jest.fn() }));

describe("local Ops admin setup", () => {
  const env = {
    NODE_ENV: "development",
    DATABASE_URL: "mysql://fixture@127.0.0.1:3306/ops_verify",
    SEED_ADMIN_EMAIL: " Owner@Example.test ",
    SEED_ADMIN_PASSWORD: "LocalFixture2026!",
  };
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("normalizes the configured email", () => {
    expect(localAdminConfig(env).email).toBe("owner@example.test");
  });
  it.each([
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { DATABASE_URL: "mysql://fixture@database.example.test/ops" },
    { SEED_ADMIN_EMAIL: "" },
    { SEED_ADMIN_PASSWORD: "" },
    { SEED_ADMIN_PASSWORD: "a".repeat(73) },
  ])("rejects invalid local setup configuration %j", (overrides) => {
    expect(() => localAdminConfig({ ...env, ...overrides })).toThrow();
  });
  it("creates only the missing admin and delegates Ops setup", async () => {
    const findUnique = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const create = jest
      .fn<PrismaClient["user"]["create"]>()
      .mockResolvedValue({ id: "local-admin" } as Awaited<
        ReturnType<PrismaClient["user"]["create"]>
      >);
    const deleteMany = jest.fn<PrismaClient["userRole"]["deleteMany"]>();
    const upsert = jest.fn<PrismaClient["userRole"]["upsert"]>();
    const db = {
      user: { findUnique, create },
      userRole: { deleteMany, upsert },
    } as unknown as PrismaClient;
    await setupLocalOpsAdmin(db, env);
    const data = create.mock.calls[0][0].data;
    expect(data.email).toBe("owner@example.test");
    expect(data.roles).toEqual({ create: { role: "system_admin" } });
    expect(await bcrypt.compare(env.SEED_ADMIN_PASSWORD, data.passwordHash as string)).toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "local-admin", role: "ceo" },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_role: { userId: "local-admin", role: "system_admin" } },
      create: { userId: "local-admin", role: "system_admin" },
      update: {},
    });
    expect(bootstrapOps).toHaveBeenCalledWith(db, "owner@example.test");
  });
  it("preserves a matching existing account", async () => {
    const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 4);
    const findUnique = jest
      .fn<() => Promise<{ id: string; passwordHash: string }>>()
      .mockResolvedValue({ id: "local-admin", passwordHash });
    const create = jest.fn();
    const deleteMany = jest.fn<PrismaClient["userRole"]["deleteMany"]>();
    const upsert = jest.fn<PrismaClient["userRole"]["upsert"]>();
    const db = {
      user: { findUnique, create },
      userRole: { deleteMany, upsert },
    } as unknown as PrismaClient;
    await setupLocalOpsAdmin(db, env);
    expect(create).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "local-admin", role: "ceo" },
    });
    expect(bootstrapOps).toHaveBeenCalledWith(db, "owner@example.test");
  });
  it("refuses to reset an existing password", async () => {
    const passwordHash = await bcrypt.hash("ExistingFixture2026!", 4);
    const findUnique = jest
      .fn<() => Promise<{ id: string; passwordHash: string }>>()
      .mockResolvedValue({ id: "local-admin", passwordHash });
    const create = jest.fn();
    const deleteMany = jest.fn();
    const upsert = jest.fn();
    const db = {
      user: { findUnique, create },
      userRole: { deleteMany, upsert },
    } as unknown as PrismaClient;
    await expect(setupLocalOpsAdmin(db, env)).rejects.toThrow("password was preserved");
    expect(create).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(bootstrapOps).not.toHaveBeenCalled();
  });
  it("rejects a production database before looking up users", async () => {
    const findUnique = jest.fn();
    const db = { user: { findUnique } } as unknown as PrismaClient;
    await expect(setupLocalOpsAdmin(db, { ...env, NODE_ENV: "production" })).rejects.toThrow();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
