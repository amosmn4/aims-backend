import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ExpenseCategory, Prisma, WaterExpenseCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ExpensesService } from "../finance/expenses/expenses.service";
import { companyDateKey, startOfDay } from "../common/date-range";
import { maybePaginate, type PaginationQueryDto } from "../common/pagination";
import {
  WATER_EXPENSE_CATEGORIES,
  type CreateWaterExpenseDto,
  type UpdateWaterExpenseDto,
  type PayWaterExpenseDto,
} from "./dto/water-expense.dto";

const FINANCE_CATEGORIES: Record<WaterExpenseCategory, ExpenseCategory> = {
  electricity: "utilities",
  maintenance: "subcontractors",
  repairs: "subcontractors",
  equipment: "equipment",
  staff: "salaries",
  other: "other",
};

export function waterExpenseMonthRange(month = companyDateKey().slice(0, 7)) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException("Choose a valid month");
  const [year, number] = month.split("-").map(Number);
  return {
    month,
    start: new Date(Date.UTC(year, number - 1, 1)),
    end: new Date(Date.UTC(year, number, 1)),
  };
}

function expenseDate(value: string, label: string) {
  const date = new Date(value);
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException(`Choose a valid ${label}`);
  return date;
}

const SCOPE = { waterCategory: { not: null }, currencyCode: "KES" } as const;
const money = (amount: number) => Math.round(amount * 100) / 100;

@Injectable()
export class WaterExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesService,
  ) {}

  list(
    filters: { month?: string; category?: string; status?: string; q?: string },
    pagination: PaginationQueryDto = {},
  ) {
    const { start, end } = waterExpenseMonthRange(filters.month);
    if (
      filters.category &&
      !WATER_EXPENSE_CATEGORIES.includes(filters.category as WaterExpenseCategory)
    )
      throw new BadRequestException("Choose a valid expense category");
    if (filters.status && !["paid", "unpaid"].includes(filters.status))
      throw new BadRequestException("Choose paid or unpaid");
    const q = filters.q?.trim();
    const where: Prisma.ExpenseWhereInput = {
      ...SCOPE,
      expenseDate: { gte: start, lt: end },
      ...(filters.category && { waterCategory: filters.category as WaterExpenseCategory }),
      ...(filters.status && { status: filters.status as "paid" | "unpaid" }),
      ...(q && {
        OR: [
          { description: { contains: q } },
          { supplier: { contains: q } },
          { reference: { contains: q } },
        ],
      }),
    };
    return maybePaginate(
      this.prisma.expense,
      { where, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }, { id: "desc" }] },
      pagination,
    );
  }

  async create(dto: CreateWaterExpenseDto, userId: string) {
    return this.expenses.create(this.financeInput(dto), userId, dto.category);
  }

  async update(id: string, dto: UpdateWaterExpenseDto) {
    const existing = await this.requireExpense(id);
    const input: CreateWaterExpenseDto = {
      expenseDate:
        dto.expenseDate === undefined
          ? existing.expenseDate.toISOString().slice(0, 10)
          : dto.expenseDate,
      category: dto.category === undefined ? existing.waterCategory! : dto.category,
      description: dto.description === undefined ? existing.description : dto.description,
      amount: dto.amount === undefined ? Number(existing.amount) : dto.amount,
      supplier: dto.supplier === undefined ? (existing.supplier ?? undefined) : dto.supplier,
      reference: dto.reference === undefined ? (existing.reference ?? undefined) : dto.reference,
      paidOn:
        dto.paidOn === undefined
          ? (existing.paidOn?.toISOString().slice(0, 10) ?? null)
          : dto.paidOn,
    };
    return this.expenses.update(id, this.financeInput(input), input.category);
  }

  async pay(id: string, dto: PayWaterExpenseDto) {
    await this.requireExpense(id);
    expenseDate(dto.paidOn, "payment date");
    return this.expenses.pay(id, dto);
  }

  async totals(start: Date, end: Date) {
    const [recorded, paid] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ["waterCategory", "status"],
        where: { ...SCOPE, expenseDate: { gte: start, lt: end } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ["waterCategory"],
        where: { ...SCOPE, status: "paid", paidOn: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
    ]);
    const categories = WATER_EXPENSE_CATEGORIES.map((category) => {
      const rows = recorded.filter((row) => row.waterCategory === category);
      return {
        category,
        recorded: money(rows.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0)),
        paid: money(Number(paid.find((row) => row.waterCategory === category)?._sum.amount ?? 0)),
        unpaid: money(
          rows
            .filter((row) => row.status === "unpaid")
            .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0),
        ),
        count: rows.reduce((sum, row) => sum + row._count._all, 0),
      };
    });
    return {
      recorded: money(categories.reduce((sum, row) => sum + row.recorded, 0)),
      paid: money(categories.reduce((sum, row) => sum + row.paid, 0)),
      unpaid: money(categories.reduce((sum, row) => sum + row.unpaid, 0)),
      count: categories.reduce((sum, row) => sum + row.count, 0),
      categories,
    };
  }

  async summary(month?: string) {
    const { month: key, start, end } = waterExpenseMonthRange(month);
    const [expenses, usage] = await Promise.all([
      this.totals(start, end),
      this.prisma.waterUsageRecord.aggregate({
        where: {
          recordedAt: {
            gte: startOfDay(`${key}-01`),
            lt: startOfDay(end.toISOString().slice(0, 10)),
          },
        },
        _sum: { amountPaid: true, unitsSold: true },
      }),
    ]);
    const collections = Number(usage._sum.amountPaid ?? 0);
    return {
      month: key,
      collections,
      unitsSold: Number(usage._sum.unitsSold ?? 0),
      cashAfterExpenses: money(collections - expenses.paid),
      expenses,
    };
  }

  private async requireExpense(id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, ...SCOPE } });
    if (!expense) throw new NotFoundException("Water expense not found");
    return expense;
  }

  private financeInput(dto: CreateWaterExpenseDto) {
    expenseDate(dto.expenseDate, "expense date");
    if (!WATER_EXPENSE_CATEGORIES.includes(dto.category))
      throw new BadRequestException("Choose a valid expense category");
    if (typeof dto.description !== "string" || dto.description.trim().length < 2)
      throw new BadRequestException("Describe the expense in a few words");
    if (
      typeof dto.amount !== "number" ||
      !Number.isFinite(dto.amount) ||
      dto.amount <= 0 ||
      dto.amount > 999999999999.99 ||
      Math.abs(dto.amount - money(dto.amount)) > 0.00001
    )
      throw new BadRequestException(
        "Enter an amount greater than zero with at most two decimal places",
      );
    if (dto.paidOn !== null && dto.paidOn !== undefined) expenseDate(dto.paidOn, "payment date");
    return {
      expenseDate: dto.expenseDate,
      category: FINANCE_CATEGORIES[dto.category],
      description: dto.description.trim(),
      amount: dto.amount,
      supplier: dto.supplier ?? undefined,
      reference: dto.reference ?? undefined,
      paidOn: dto.paidOn ?? null,
      currencyCode: "KES",
    };
  }
}
