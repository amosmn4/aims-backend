import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TendersService } from "./tenders.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { DocumentsService } from "../../documents/documents.service";
import type { ThreadsService } from "../../threads/threads.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { TenderStage } from "@prisma/client";

const staff: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["it"],
  departmentId: "it",
};
const ceo: AuthenticatedUser = { ...staff, roles: ["ceo"] };

function fixture(stage: TenderStage = "applying") {
  const tender = {
    id: "bid",
    stage,
    accountManagerId: "other",
    accountManager: null,
    department: { id: "hr", code: "hr" },
    submittedAt: new Date("2026-09-01"),
    wonAt: new Date("2026-09-20"),
    lostAt: new Date("2026-09-15"),
    withdrawnAt: null,
    cancelledAt: null,
    lostFromStage: "applying",
    wonReason: "Strong proposal",
    lostReason: "Budget",
  };
  const prisma = {
    department: {
      findMany: jest.fn(async () => [
        { id: "it", code: "it" },
        { id: "hr", code: "hr" },
        { id: "tender", code: "tender" },
      ]),
      findUnique: jest.fn(async () => ({ id: "tender", code: "tender" })),
    },
    userPermissionOverride: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
    resourceAccessGrant: { findMany: jest.fn(async () => []) },
    tenderResource: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    tender: {
      findUniqueOrThrow: jest.fn(async () => tender),
      findMany: jest.fn(async (_query: unknown) => []),
      count: jest.fn(async (_query: unknown) => 2),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...tender,
        ...data,
      })),
    },
    stageChange: { create: jest.fn(async () => ({})) },
  };
  const service = new TendersService(
    {} as ThreadsService,
    prisma as unknown as PrismaService,
    {} as DocumentsService,
  );
  return { tender, prisma, service };
}

describe("tender workflow and scope", () => {
  it.each([
    "listAccessGrants",
    "listResources",
    "listTimeEntries",
    "getCostSummary",
    "listBonds",
    "listPricingItems",
    "getFinancialsSummary",
    "listRequirements",
    "listActivities",
  ] as const)("checks parent access before %s", async (method) => {
    const { service, prisma } = fixture();
    await expect(service[method]("bid", staff)).rejects.toThrow(NotFoundException);
    expect(prisma.tenderResource.findMany).not.toHaveBeenCalled();
  });

  it("keeps an account manager's read access read-only", async () => {
    const { service, tender } = fixture();
    tender.accountManagerId = staff.id;
    await expect(service.findOne("bid", staff)).resolves.toMatchObject({ canEdit: false });
  });

  it("applies search and access as separate conditions", async () => {
    const { service, prisma } = fixture();
    await service.findAll({ q: "staffing" }, staff);
    const query = prisma.tender.findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(query.where.AND).toHaveLength(2);
    expect(query.where.AND[0]).toMatchObject({
      OR: [{ title: { contains: "staffing" } }, {}, {}, {}],
    });
    expect(query.where.AND[1]).toMatchObject({
      OR: [
        { department: { code: { in: ["it"] } } },
        { accountManagerId: staff.id },
        { resources: { some: { userId: staff.id } } },
        { id: { in: [] } },
      ],
    });
  });

  it("bounds daily queue rows while keeping full totals and preparing-stage checks", async () => {
    const { service, prisma } = fixture();
    const result = await service.workQueue(ceo);
    expect(result.totals.closingTotal).toBe(2);
    expect(prisma.tender.findMany.mock.calls).toHaveLength(3);
    for (const [query] of prisma.tender.findMany.mock.calls)
      expect(query).toMatchObject({ take: 6 });
    expect(prisma.tender.count.mock.calls[0][0]).toMatchObject({
      where: { stage: { in: ["identified", "applying"] } },
    });
    expect(prisma.tender.count.mock.calls[2][0]).toMatchObject({
      where: { stage: "won", project: null },
    });
  });

  it("sets the bid owner to the person registering it", async () => {
    const { service } = fixture();
    await expect(
      service.create({ title: "  Staffing bid  ", departmentId: "hr" }, ceo),
    ).resolves.toMatchObject({ title: "Staffing bid", accountManagerId: ceo.id });
  });

  it("rejects a blank bid title", async () => {
    await expect(
      fixture().service.create({ title: "  ", departmentId: "hr" }, ceo),
    ).rejects.toThrow(BadRequestException);
  });

  it("preserves the original award date when editing award notes", async () => {
    const { service, tender } = fixture("won");
    await expect(
      service.updateStage("bid", { stage: "won", wonReason: "Updated notes" }, ceo),
    ).resolves.toMatchObject({ wonAt: tender.wonAt });
  });

  it("preserves the original exit point when correcting an exit stage", async () => {
    const { service, tender } = fixture("lost");
    await expect(
      service.updateStage("bid", { stage: "cancelled", lostReason: "Client cancelled" }, ceo),
    ).resolves.toMatchObject({ lostFromStage: "applying", lostAt: tender.lostAt });
  });
});
