import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateBudgetDto } from "./dto/create-budget.dto";
import type { UpdateBudgetDto } from "./dto/update-budget.dto";

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const budgets = await this.prisma.budget.findMany({
      include: { department: true, contract: true },
      orderBy: { periodStart: "desc" },
    });
    return Promise.all(budgets.map(async (b) => ({ ...b, actual: await this.computeActual(b) })));
  }

  private async computeActual(b: {
    contractId: string | null;
    departmentId: string | null;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const where: Prisma.InvoiceWhereInput = {
      status: { notIn: ["draft", "void"] },
      issueDate: { gte: b.periodStart, lte: b.periodEnd },
    };
    if (b.contractId) {
      where.contractId = b.contractId;
    } else if (b.departmentId) {
      where.contract = { departmentId: b.departmentId };
    } else {
      return 0;
    }
    const agg = await this.prisma.invoice.aggregate({ where, _sum: { total: true } });
    return Number(agg._sum.total ?? 0);
  }

  private assertExactlyOneTarget(departmentId?: string, contractId?: string) {
    if ((!departmentId && !contractId) || (departmentId && contractId)) {
      throw new BadRequestException(
        "A budget must have exactly one of departmentId or contractId set",
      );
    }
  }

  create(dto: CreateBudgetDto, userId: string) {
    this.assertExactlyOneTarget(dto.departmentId, dto.contractId);
    return this.prisma.budget.create({
      data: {
        departmentId: dto.departmentId,
        contractId: dto.contractId,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        budgetedAmount: dto.budgetedAmount,
        currency: dto.currency ?? "KES",
        notes: dto.notes,
        createdBy: userId,
      },
    });
  }

  async update(id: string, dto: UpdateBudgetDto) {
    if (dto.departmentId !== undefined || dto.contractId !== undefined) {
      const existing = await this.prisma.budget.findUniqueOrThrow({ where: { id } });
      this.assertExactlyOneTarget(
        dto.departmentId ?? existing.departmentId ?? undefined,
        dto.contractId ?? existing.contractId ?? undefined,
      );
    }
    return this.prisma.budget.update({
      where: { id },
      data: {
        ...dto,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
      },
    });
  }

  remove(id: string) {
    return this.prisma.budget.delete({ where: { id } });
  }
}
