import { describe, expect, it, jest } from "@jest/globals";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
  ValidationPipe,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppRole, Expense, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ExpensesService } from "../finance/expenses/expenses.service";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ViewAsGuard } from "../auth/guards/view-as.guard";
import { WaterExpensesController } from "./water-expenses.controller";
import { WaterExpensesService, waterExpenseMonthRange } from "./water-expenses.service";
import { CreateWaterExpenseDto, UpdateWaterExpenseDto } from "./dto/water-expense.dto";

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const input = {
  expenseDate: "2026-10-13",
  category: "electricity" as const,
  description: " Pumping power ",
  amount: 1250.25,
  paidOn: "2026-10-13",
};

function fixture() {
  const rows = [
    {
      id: "old",
      waterCategory: "electricity",
      category: "utilities",
      expenseDate: date("2026-09-30"),
      paidOn: date("2026-10-01"),
      status: "paid",
      amount: 55.55,
      currencyCode: "KES",
    },
    {
      id: "current",
      waterCategory: "electricity",
      category: "utilities",
      expenseDate: date("2026-10-03"),
      paidOn: date("2026-10-03"),
      status: "paid",
      amount: 30.25,
      currencyCode: "KES",
    },
    {
      id: "unpaid",
      waterCategory: "repairs",
      category: "subcontractors",
      expenseDate: date("2026-10-31"),
      paidOn: null,
      status: "unpaid",
      amount: 40.4,
      currencyCode: "KES",
    },
    {
      id: "later-payment",
      waterCategory: "equipment",
      category: "equipment",
      expenseDate: date("2026-10-31"),
      paidOn: date("2026-11-01"),
      status: "paid",
      amount: 10,
      currencyCode: "KES",
    },
    {
      id: "next-month",
      waterCategory: "electricity",
      category: "utilities",
      expenseDate: date("2026-11-01"),
      paidOn: date("2026-11-01"),
      status: "paid",
      amount: 100,
      currencyCode: "KES",
    },
    {
      id: "company",
      waterCategory: null,
      category: "utilities",
      expenseDate: date("2026-10-01"),
      paidOn: date("2026-10-01"),
      status: "paid",
      amount: 90000,
      currencyCode: "KES",
    },
    {
      id: "foreign",
      waterCategory: "electricity",
      category: "utilities",
      expenseDate: date("2026-10-01"),
      paidOn: date("2026-10-01"),
      status: "paid",
      amount: 50000,
      currencyCode: "USD",
    },
  ].map((row) => ({
    ...row,
    description: "Pumping power",
    supplier: "Power company",
    reference: "OLD-REF",
    createdAt: date("2026-10-01"),
    updatedAt: date("2026-10-01"),
    createdBy: "staff",
    departmentId: null,
    serviceLineId: null,
    projectId: null,
    dueDate: null,
  })) as unknown as Expense[];
  const matches = (row: Expense, where: Prisma.ExpenseWhereInput) => {
    const range = (where.expenseDate ?? where.paidOn) as { gte: Date; lt: Date } | undefined;
    const value = where.expenseDate ? row.expenseDate : row.paidOn;
    return (
      (!where.id || row.id === where.id) &&
      row.waterCategory !== null &&
      row.currencyCode === "KES" &&
      (!where.status || row.status === where.status) &&
      (!range || (!!value && value >= range.gte && value < range.lt))
    );
  };
  const prisma = {
    expense: {
      groupBy: jest.fn(async ({ by, where }: { by: string[]; where: Prisma.ExpenseWhereInput }) => {
        const grouped = new Map<
          string,
          {
            waterCategory: Expense["waterCategory"];
            status: Expense["status"];
            _sum: { amount: number };
            _count: { _all: number };
          }
        >();
        for (const row of rows.filter((row) => matches(row, where))) {
          const key = `${row.waterCategory}-${by.includes("status") ? row.status : "all"}`;
          const total = grouped.get(key) ?? {
            waterCategory: row.waterCategory,
            status: row.status,
            _sum: { amount: 0 },
            _count: { _all: 0 },
          };
          total._sum.amount += Number(row.amount);
          total._count._all += 1;
          grouped.set(key, total);
        }
        return [...grouped.values()];
      }),
      findFirst: jest.fn(
        async ({ where }: { where: Prisma.ExpenseWhereInput }) =>
          rows.find((row) => matches(row, where)) ?? null,
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
      findMany: jest.fn(async (_query: unknown) => []),
      count: jest.fn(async (_query: unknown) => 0),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      update: jest.fn(async ({ data }: { data: unknown }) => data),
    },
    waterUsageRecord: {
      aggregate: jest.fn(async (_query: unknown) => ({
        _sum: { amountPaid: 1000.01, unitsSold: 50 },
      })),
    },
  };
  const db = prisma as unknown as PrismaService;
  const finance = new ExpensesService(db);
  return { prisma, finance, service: new WaterExpensesService(db, finance) };
}

describe("Water expenses", () => {
  it("separates incurred costs, payments for older bills and current unpaid bills at month boundaries", async () => {
    const { service, prisma } = fixture();
    const result = await service.summary("2026-10");
    expect(result.expenses).toMatchObject({ recorded: 80.65, paid: 85.8, unpaid: 40.4, count: 3 });
    expect(result.cashAfterExpenses).toBe(914.21);
    expect(result.expenses.categories.find((row) => row.category === "electricity")).toMatchObject({
      recorded: 30.25,
      paid: 85.8,
    });
    expect(prisma.expense.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.waterUsageRecord.aggregate).toHaveBeenCalledWith({
      where: {
        recordedAt: { gte: new Date("2026-09-30T21:00:00Z"), lt: new Date("2026-10-31T21:00:00Z") },
      },
      _sum: { amountPaid: true, unitsSold: true },
    });
  });

  it("preserves negative cash when paid expenses exceed collections", async () => {
    const { service, prisma } = fixture();
    prisma.waterUsageRecord.aggregate.mockResolvedValue({ _sum: { amountPaid: 20, unitsSold: 2 } });
    expect((await service.summary("2026-10")).cashAfterExpenses).toBe(-65.8);
  });

  it("writes one Finance expense with a Water marker, KES, creator and paid status", async () => {
    const { service, prisma } = fixture();
    await service.create(input, "water-user");
    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          waterCategory: "electricity",
          category: "utilities",
          description: "Pumping power",
          amount: 1250.25,
          createdBy: "water-user",
          currencyCode: "KES",
          status: "paid",
          paidOn: date("2026-10-13"),
        }),
      }),
    );
  });

  it("records unpaid costs without inventing a payment date", async () => {
    const { service, prisma } = fixture();
    await service.create({ ...input, category: "repairs", paidOn: null }, "water-user");
    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ waterCategory: "repairs", status: "unpaid", paidOn: null }),
      }),
    );
  });

  it("preserves optional fields on partial edits and maps the new category", async () => {
    const { service, prisma } = fixture();
    await service.update("current", { category: "equipment", amount: 15.5 });
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          waterCategory: "equipment",
          category: "equipment",
          amount: 15.5,
          supplier: "Power company",
          reference: "OLD-REF",
          paidOn: date("2026-10-03"),
        }),
      }),
    );
  });

  it("cannot edit or pay an unrelated Finance expense, foreign-currency record or missing id", async () => {
    const { service, prisma } = fixture();
    for (const id of ["company", "foreign", "missing"]) {
      await expect(service.update(id, { amount: 10 })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.pay(id, { paidOn: "2026-10-13" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  it("marks a Water bill paid through the shared Finance payment workflow", async () => {
    const { service, prisma } = fixture();
    await service.pay("unpaid", { paidOn: "2026-11-02", reference: "PAY-REF" });
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "paid",
          paidOn: date("2026-11-02"),
          reference: "PAY-REF",
        }),
      }),
    );
    await expect(service.pay("current", { paidOn: "2026-10-13" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects invalid dates, empty descriptions and nonpositive or overprecision costs", async () => {
    const { service, prisma } = fixture();
    for (const dto of [
      { ...input, expenseDate: "2026-02-30" },
      { ...input, paidOn: "2026-02-30" },
      { ...input, description: "  " },
      { ...input, amount: 0 },
      { ...input, amount: 2.123 },
      { ...input, amount: Infinity },
    ])
      await expect(service.create(dto, "staff")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it("filters and paginates only Water records and rejects invalid filter values", async () => {
    const { service, prisma } = fixture();
    await service.list(
      { month: "2026-10", category: "electricity", status: "unpaid", q: " pump " },
      { page: 2, pageSize: 25 },
    );
    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: expect.objectContaining({
          waterCategory: "electricity",
          currencyCode: "KES",
          status: "unpaid",
          expenseDate: { gte: date("2026-10-01"), lt: date("2026-11-01") },
          OR: expect.arrayContaining([{ description: { contains: "pump" } }]),
        }),
      }),
    );
    expect(() => service.list({ category: "not-a-category" })).toThrow(BadRequestException);
    expect(() => service.list({ status: "void" })).toThrow(BadRequestException);
    for (const key of ["2026-13", "2026-00", "not-a-month"])
      expect(() => waterExpenseMonthRange(key)).toThrow(BadRequestException);
  });

  it("prevents Finance from changing a Water expense currency while preserving ordinary Finance edits", async () => {
    const { finance, prisma } = fixture();
    await expect(finance.update("current", { currencyCode: "USD" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await finance.update("company", { currencyCode: "USD" });
    expect(prisma.expense.update).toHaveBeenCalledTimes(1);
  });

  it("validates Water-only fields and rejects client supplied scoping and currency fields", async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const meta = { type: "body" as const, metatype: CreateWaterExpenseDto };
    expect(await pipe.transform(input, meta)).toMatchObject({ description: "Pumping power" });
    for (const extra of [
      { departmentId: "finance" },
      { currencyCode: "USD" },
      { waterCategory: "other" },
    ])
      await expect(pipe.transform({ ...input, ...extra }, meta)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    await expect(
      pipe.transform({ amount: null }, { type: "body", metatype: UpdateWaterExpenseDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ paidOn: null }, { type: "body", metatype: UpdateWaterExpenseDto }),
    ).resolves.toBeDefined();
  });

  it("uses Water roles for read and write endpoints, with CEO/admin access and read-only View As", () => {
    const roles = new RolesGuard(new Reflector());
    const viewAs = new ViewAsGuard();
    const context = (role: AppRole, actorId?: string) =>
      ({
        getClass: () => WaterExpensesController,
        getHandler: () => WaterExpensesController.prototype.create,
        switchToHttp: () => ({
          getRequest: () => ({
            method: "POST",
            originalUrl: "/api/v1/water/expenses",
            user: { id: "user", roles: [role], actorId },
          }),
        }),
      }) as unknown as ExecutionContext;
    for (const role of ["water", "ceo", "system_admin"] as AppRole[])
      expect(roles.canActivate(context(role))).toBe(true);
    expect(() => roles.canActivate(context("finance"))).toThrow(ForbiddenException);
    expect(() => roles.canActivate(context("hr"))).toThrow(ForbiddenException);
    expect(() => viewAs.canActivate(context("water", "admin"))).toThrow(ForbiddenException);
  });
});
