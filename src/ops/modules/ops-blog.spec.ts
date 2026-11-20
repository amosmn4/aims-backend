import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import type { StorageService } from "../../storage/storage.service";
import { BlogService } from "../../marketing/blog/blog.service";
import { OpsBlogController } from "./ops-blog.controller";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

describe("Ops Blog pagination", () => {
  it("clamps an obsolete page after posts are removed and keeps the unpaginated contract", async () => {
    const items = [{ id: "last-post" }];
    const findMany = jest.fn<(...args: unknown[]) => Promise<object[]>>().mockResolvedValue(items);
    const db = { blogPost: { count: async () => 21, findMany } };
    const prisma = {
      ...db,
      $transaction: async (work: (value: typeof db) => Promise<unknown>) => work(db),
    } as unknown as PrismaService;
    const service = new BlogService(prisma, {} as StorageService);
    const controller = new OpsBlogController(service, {} as StorageService);
    expect(await controller.findAll({ page: "8", limit: "10" })).toEqual({
      items,
      total: 21,
      page: 3,
      limit: 10,
    });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(await controller.findAll({})).toEqual(items);
  });
  it("rejects invalid pagination before querying Blog records", () => {
    const service = { findPage: jest.fn(), findAll: jest.fn() } as unknown as BlogService;
    const controller = new OpsBlogController(service, {} as StorageService);
    expect(() => controller.findAll({ limit: "1000" })).toThrow(BadRequestException);
    expect(() => controller.findAll({ page: "-1" })).toThrow(BadRequestException);
    expect(service.findPage).not.toHaveBeenCalled();
  });
});
