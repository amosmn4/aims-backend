import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateInvoiceDto } from "./dto/create-invoice.dto";
import type { CreatePaymentDto } from "./dto/create-payment.dto";
import type { CreateFollowUpDto } from "./dto/create-follow-up.dto";

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  // departmentId filters via Invoice.contract.departmentId — Invoice has no direct department
  // column, it's only reachable through its (nullable) linked Contract.
  findAll(filters: { departmentId?: string } = {}) {
    return this.prisma.invoice.findMany({
      where: {
        ...(filters.departmentId && { contract: { departmentId: filters.departmentId } }),
      },
      orderBy: { issueDate: "desc" },
    });
  }

  create(dto: CreateInvoiceDto, userId: string) {
    const tax = dto.tax ?? 0;
    return this.prisma.invoice.create({
      data: {
        invoiceNumber: dto.invoiceNumber,
        clientId: dto.clientId,
        serviceLineId: dto.serviceLineId,
        contractId: dto.contractId,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: dto.currencyCode ?? "KES",
        subtotal: dto.subtotal,
        tax,
        total: dto.subtotal + tax,
        directCost: dto.directCost ?? 0,
        status: dto.status ?? "sent",
        isRecurring: dto.isRecurring ?? false,
        notes: dto.notes,
        createdBy: userId,
      },
    });
  }

  findAllPayments() {
    return this.prisma.invoicePayment.findMany({ orderBy: { paidOn: "desc" } });
  }

  async recordPayment(invoiceId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          paidOn: new Date(dto.paidOn),
          method: dto.method,
          reference: dto.reference,
        },
      });
      const paidSoFar = await tx.invoicePayment.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      });
      const totalPaid = Number(paidSoFar._sum.amount ?? 0);
      const newStatus = totalPaid >= Number(invoice.total) - 0.01 ? "paid" : "partial";
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: newStatus } });
      return payment;
    });
  }

  findFollowUps(invoiceId: string) {
    return this.prisma.debtorFollowUp.findMany({
      where: { invoiceId },
      orderBy: { createdAt: "desc" },
    });
  }

  createFollowUp(invoiceId: string, dto: CreateFollowUpDto, userId: string) {
    return this.prisma.debtorFollowUp.create({
      data: {
        invoiceId,
        type: dto.type,
        channel: dto.channel,
        promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : undefined,
        notes: dto.notes,
        createdBy: userId,
      },
    });
  }
}
