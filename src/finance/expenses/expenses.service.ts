import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ExpenseStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateExpenseDto, PayExpenseDto, UpdateExpenseDto } from "./dto/expense.dto";

const INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  serviceLine: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  list(filters: {
    from?: string;
    to?: string;
    status?: string;
    departmentId?: string;
    q?: string;
  }) {
    const date: Prisma.DateTimeFilter = {};
    if (filters.from) date.gte = new Date(filters.from);
    if (filters.to) date.lte = new Date(filters.to);
    const status = (["paid", "unpaid"] as ExpenseStatus[]).find((x) => x === filters.status);
    return this.prisma.expense.findMany({
      where: {
        ...(Object.keys(date).length && { expenseDate: date }),
        ...(status && { status }),
        ...(filters.departmentId && { departmentId: filters.departmentId }),
        ...(filters.q && {
          OR: [
            { description: { contains: filters.q } },
            { supplier: { contains: filters.q } },
            { reference: { contains: filters.q } },
          ],
        }),
      },
      include: INCLUDE,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    });
  }

  async create(dto: CreateExpenseDto, userId: string) {
    await this.assertLinks(dto);
    return this.prisma.expense.create({
      data: {
        ...this.fields(dto),
        expenseDate: new Date(dto.expenseDate),
        description: dto.description.trim(),
        category: dto.category,
        amount: dto.amount,
        status: dto.paidOn ? "paid" : "unpaid",
        createdBy: userId,
      },
      include: INCLUDE,
    });
  }

  async update(id: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Expense not found");
    await this.assertLinks(dto);
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...this.fields(dto),
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        description: dto.description?.trim(),
        category: dto.category,
        amount: dto.amount,
        ...(dto.paidOn !== undefined && { status: dto.paidOn ? "paid" : "unpaid" }),
      },
      include: INCLUDE,
    });
  }

  async pay(id: string, dto: PayExpenseDto) {
    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Expense not found");
    if (existing.status === "paid")
      throw new BadRequestException("This expense is already marked as paid");
    return this.prisma.expense.update({
      where: { id },
      data: {
        status: "paid",
        paidOn: new Date(dto.paidOn),
        reference: dto.reference ?? existing.reference,
      },
      include: INCLUDE,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Expense not found");
    await this.prisma.expense.delete({ where: { id } });
    return { id };
  }

  private fields(dto: UpdateExpenseDto) {
    return {
      dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
      supplier: dto.supplier === undefined ? undefined : dto.supplier.trim() || null,
      currencyCode: dto.currencyCode,
      departmentId: dto.departmentId === undefined ? undefined : dto.departmentId || null,
      serviceLineId: dto.serviceLineId === undefined ? undefined : dto.serviceLineId || null,
      projectId: dto.projectId === undefined ? undefined : dto.projectId || null,
      paidOn: dto.paidOn === undefined ? undefined : dto.paidOn ? new Date(dto.paidOn) : null,
      reference: dto.reference === undefined ? undefined : dto.reference.trim() || null,
    };
  }

  private async assertLinks(dto: UpdateExpenseDto) {
    if (dto.expenseDate && dto.dueDate && new Date(dto.dueDate) < new Date(dto.expenseDate)) {
      throw new BadRequestException("The due date can't be before the expense date");
    }
    if (
      dto.serviceLineId &&
      !(await this.prisma.serviceLine.findUnique({ where: { id: dto.serviceLineId } }))
    ) {
      throw new BadRequestException("That service line no longer exists");
    }
    if (
      dto.projectId &&
      !(await this.prisma.project.findUnique({ where: { id: dto.projectId } }))
    ) {
      throw new BadRequestException("That project no longer exists");
    }
  }
}
