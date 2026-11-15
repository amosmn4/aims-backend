import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { PrismaService } from "../../prisma/prisma.service";
import type { TendersService } from "../../crm/tenders/tenders.service";
import type { Viewer } from "../ops.schemas";
import { OpsTendersService } from "./ops-tenders.service";

describe("OpsTendersService", () => {
  const findUnique = jest.fn<
    (query: { where: { id: string }; include: { roles: true } }) => Promise<unknown>
  >();
  const findAll = jest.fn<(filters: object, user: AuthenticatedUser) => Promise<unknown>>();
  const findMany = jest.fn<() => Promise<unknown[]>>();
  const findFirst = jest.fn<() => Promise<unknown>>();
  const update = jest.fn<
    (id: string, value: { accountManagerId: string }, user: AuthenticatedUser) => Promise<unknown>
  >();
  const prisma = {
    user: { findUnique },
    opsStaff: { findMany, findFirst },
  } as unknown as PrismaService;
  const tenders = { findAll, update } as unknown as TendersService;
  const service = new OpsTendersService(prisma, tenders);
  const userId = "aims-user-id";
  const viewer: Viewer = {
    id: "ops-staff-id",
    userId,
    name: "Tender Viewer",
    title: "Consultant",
    dept: "operations",
    role: "staff",
    active: true,
    email: "viewer@example.com",
    sessionId: "session-id",
  };
  const ceoViewer: Viewer = {
    ...viewer,
    role: "ceo",
    userId: "ceo-user-id",
  };

  beforeEach(() => {
    findUnique.mockReset();
    findAll.mockReset();
    findMany.mockReset();
    findFirst.mockReset();
    update.mockReset();
  });

  it("uses the linked AIMS identity and its roles to read production tenders", async () => {
    findUnique.mockImplementation(async () => ({
      id: userId,
      email: viewer.email,
      isActive: true,
      departmentId: "department-id",
      roles: [{ role: "tender" }],
    }));
    findAll.mockImplementation(async () => []);

    await expect(service.list(viewer)).resolves.toEqual([]);
    expect(findAll).toHaveBeenCalledWith(
      {},
      {
        id: userId,
        email: viewer.email,
        roles: ["tender"],
        departmentId: "department-id",
      } satisfies AuthenticatedUser,
    );
  });

  it("rejects unlinked or inactive identities", async () => {
    await expect(service.list({ ...viewer, userId: null })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    findUnique.mockImplementation(async () => null);
    await expect(service.list(viewer)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("lists active Ops staff as CEO-only production tender assignees", async () => {
    findMany.mockImplementation(async () => [
      { name: "Ops Staff", user: { id: "staff-user-id", fullName: "Staff Member" } },
      { name: "Unlinked Staff", user: null },
    ]);

    await expect(service.assignees(ceoViewer)).resolves.toEqual([
      { id: "staff-user-id", name: "Staff Member" },
    ]);
    await expect(service.assignees(viewer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("assigns an existing production tender only to an active Ops staff account", async () => {
    findFirst.mockImplementation(async () => ({ id: "ops-staff-id" }));
    findUnique.mockImplementation(async () => ({
      id: ceoViewer.userId,
      email: ceoViewer.email,
      isActive: true,
      departmentId: "department-id",
      roles: [{ role: "ceo" }],
    }));
    update.mockImplementation(async () => ({ id: "tender-id" }));

    await expect(
      service.assign(ceoViewer, "tender-id", "staff-user-id"),
    ).resolves.toEqual({ id: "tender-id" });
    expect(update).toHaveBeenCalledWith(
      "tender-id",
      { accountManagerId: "staff-user-id" },
      expect.objectContaining({ id: "ceo-user-id", roles: ["ceo"] }),
    );
    await expect(service.assign(viewer, "tender-id", "staff-user-id")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    findFirst.mockImplementation(async () => null);
    await expect(
      service.assign(ceoViewer, "tender-id", "inactive-user-id"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
