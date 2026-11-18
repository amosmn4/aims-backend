import { describe, expect, it, jest } from "@jest/globals";
import { PrismaService } from "../prisma/prisma.service";
import { OpsHealthController } from "./ops-health.controller";

describe("OpsHealthController", () => {
  it("reports when production Ops has not been initialized", async () => {
    const prisma = {
      $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ 1: 1 }]),
      opsState: { count: jest.fn<() => Promise<number>>().mockResolvedValue(0) },
      opsWeeklySettings: { count: jest.fn<() => Promise<number>>().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const controller = new OpsHealthController(prisma);

    await expect(controller.health()).rejects.toThrow(
      "Ops is not initialized. Run `npm run ops:bootstrap -- EXISTING_ADMIN_EMAIL` once.",
    );
  });

  it("reports missing Ops migrations separately from initialization", async () => {
    const prisma = {
      $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ 1: 1 }]),
      opsState: {
        count: jest.fn<() => Promise<number>>().mockRejectedValue(new Error("missing table")),
      },
      opsWeeklySettings: { count: jest.fn() },
    } as unknown as PrismaService;
    const controller = new OpsHealthController(prisma);

    await expect(controller.health()).rejects.toThrow(
      "Ops database tables are missing. Apply the Prisma migrations before starting Ops.",
    );
  });

  it("returns ready after database, migration and bootstrap checks pass", async () => {
    const prisma = {
      $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ 1: 1 }]),
      opsState: { count: jest.fn<() => Promise<number>>().mockResolvedValue(1) },
      opsWeeklySettings: { count: jest.fn<() => Promise<number>>().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const controller = new OpsHealthController(prisma);

    await expect(controller.health()).resolves.toEqual({ status: "ready" });
  });
});
