import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import type { CreateInvoiceDto } from "./dto/create-invoice.dto";
import type { UpdateInvoiceDto } from "./dto/update-invoice.dto";
import type { CreatePaymentDto } from "./dto/create-payment.dto";
import type { CreateFollowUpDto } from "./dto/create-follow-up.dto";
import { ThreadsService } from "../../threads/threads.service";
import { isAdminOrCeo } from "../../common/is-admin-or-ceo";
import { maskUserRef } from "../../common/mask-user-ref";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

type Links = {
  clientId?: string;
  contractId?: string | null;
  projectId?: string | null;
  serviceLineId?: string | null;
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threads: ThreadsService,
  ) {}

  // departmentId filters via the linked contract or project.
  findAll(filters: { departmentId?: string } = {}, pagination: PaginationQueryDto = {}) {
    return maybePaginate(
      this.prisma.invoice,
      {
        where: {
          ...(filters.departmentId && {
            OR: [
              { contract: { departmentId: filters.departmentId } },
              { project: { departmentId: filters.departmentId } },
            ],
          }),
        },
        orderBy: { issueDate: "desc" },
      },
      pagination,
    );
  }

  /** Fills client, contract and service line from the project or contract the invoice belongs to. */
  private async resolveLinks(input: Links): Promise<Required<Pick<Links, "clientId">> & Links> {
    const links: Links = { ...input };
    if (links.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: links.projectId },
        select: { clientId: true, contractId: true, serviceLineId: true },
      });
      if (!project) throw new BadRequestException("That project no longer exists");
      links.contractId ??= project.contractId;
      links.clientId ??= project.clientId ?? undefined;
      links.serviceLineId ??= project.serviceLineId;
    }
    if (links.contractId) {
      const contract = await this.prisma.contract.findUnique({
        where: { id: links.contractId },
        select: { clientId: true, serviceLineId: true },
      });
      if (!contract) throw new BadRequestException("That contract no longer exists");
      if (links.clientId && links.clientId !== contract.clientId) {
        throw new BadRequestException("The invoice's client must match the contract's client");
      }
      links.clientId ??= contract.clientId;
      links.serviceLineId ??= contract.serviceLineId;
    }
    if (!links.clientId) throw new BadRequestException("Choose the client this invoice is for");
    return links as Required<Pick<Links, "clientId">> & Links;
  }

  async create(dto: CreateInvoiceDto, userId: string) {
    const links = await this.resolveLinks({
      clientId: dto.clientId,
      contractId: dto.contractId,
      projectId: dto.projectId,
      serviceLineId: dto.serviceLineId,
    });
    const serviceLine = links.serviceLineId
      ? await this.prisma.serviceLine.findUnique({
          where: { id: links.serviceLineId },
          select: { isRecurring: true },
        })
      : null;
    const tax = dto.tax ?? 0;
    return this.prisma.invoice.create({
      data: {
        invoiceNumber: dto.invoiceNumber.trim(),
        clientId: links.clientId,
        serviceLineId: links.serviceLineId ?? null,
        contractId: links.contractId ?? null,
        projectId: links.projectId ?? null,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: dto.currencyCode ?? "KES",
        subtotal: dto.subtotal,
        tax,
        total: dto.subtotal + tax,
        directCost: dto.directCost ?? 0,
        status: dto.status ?? "sent",
        isRecurring: dto.isRecurring ?? serviceLine?.isRecurring ?? false,
        notes: dto.notes,
        createdBy: userId,
      },
    });
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status === "void") throw new BadRequestException("A void invoice can't be edited");
    const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
    const subtotal = dto.subtotal ?? Number(invoice.subtotal);
    const tax = dto.tax ?? Number(invoice.tax);
    const total = subtotal + tax;
    if (total + 0.01 < paid) {
      throw new BadRequestException(
        `Payments of ${paid.toLocaleString("en-KE")} are already recorded — the total can't be lower`,
      );
    }
    const linksChanged = ["clientId", "contractId", "projectId", "serviceLineId"].some(
      (k) => k in dto,
    );
    const links = linksChanged
      ? await this.resolveLinks({
          clientId: dto.clientId ?? invoice.clientId,
          contractId: dto.contractId === undefined ? invoice.contractId : dto.contractId,
          projectId: dto.projectId === undefined ? invoice.projectId : dto.projectId,
          serviceLineId:
            dto.serviceLineId === undefined ? invoice.serviceLineId : dto.serviceLineId,
        })
      : null;
    const status =
      paid > 0 ? (paid >= total - 0.01 ? "paid" : "partial") : (dto.status ?? invoice.status);
    return this.prisma.invoice.update({
      where: { id },
      data: {
        invoiceNumber: dto.invoiceNumber?.trim(),
        ...(links && {
          clientId: links.clientId,
          contractId: links.contractId ?? null,
          projectId: links.projectId ?? null,
          serviceLineId: links.serviceLineId ?? null,
        }),
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        currencyCode: dto.currencyCode,
        subtotal,
        tax,
        total,
        directCost: dto.directCost,
        isRecurring: dto.isRecurring,
        notes: dto.notes,
        status,
      },
    });
  }

  async void(id: string, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { _count: { select: { payments: true } } },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status === "void") throw new BadRequestException("This invoice is already void");
    if (invoice._count.payments > 0) {
      throw new BadRequestException(
        "This invoice has payments recorded. Remove the payments before voiding it.",
      );
    }
    return this.prisma.invoice.update({
      where: { id },
      data: { status: "void", voidedAt: new Date(), voidReason: reason.trim() },
    });
  }

  async remove(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { _count: { select: { payments: true } } },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice._count.payments > 0) {
      throw new BadRequestException(
        "This invoice has payments recorded, so it can't be deleted. Void it instead.",
      );
    }
    await this.prisma.$transaction([
      this.prisma.debtorFollowUp.deleteMany({ where: { invoiceId: id } }),
      this.prisma.invoice.delete({ where: { id } }),
    ]);
    return { id };
  }

  findAllPayments() {
    return this.prisma.invoicePayment.findMany({ orderBy: { paidOn: "desc" } });
  }

  async recordPayment(invoiceId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { payments: true },
      });
      if (invoice.status === "void")
        throw new BadRequestException("Payments can't be recorded on a void invoice");
      const paidBefore = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
      const outstanding = Number(invoice.total) - paidBefore;
      if (dto.amount > outstanding + 0.01) {
        throw new BadRequestException(
          `Only ${outstanding.toLocaleString("en-KE")} is still owed on this invoice`,
        );
      }
      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          paidOn: new Date(dto.paidOn),
          method: dto.method,
          reference: dto.reference,
        },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: this.paidStatus(paidBefore + dto.amount, invoice.total) },
      });
      return payment;
    });
  }

  async removePayment(paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.invoicePayment.findUnique({
        where: { id: paymentId },
        include: { invoice: true },
      });
      if (!payment) throw new NotFoundException("Payment not found");
      await tx.invoicePayment.delete({ where: { id: paymentId } });
      const rest = await tx.invoicePayment.aggregate({
        where: { invoiceId: payment.invoiceId },
        _sum: { amount: true },
      });
      const paid = Number(rest._sum.amount ?? 0);
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: paid > 0 ? this.paidStatus(paid, payment.invoice.total) : "sent" },
      });
      return { id: paymentId };
    });
  }

  private paidStatus(paid: number, total: Prisma.Decimal) {
    return paid >= Number(total) - 0.01 ? "paid" : "partial";
  }

  async findFollowUps(invoiceId: string, viewer: AuthenticatedUser) {
    const rows = await this.prisma.debtorFollowUp.findMany({
      where: { invoiceId },
      orderBy: { createdAt: "desc" },
    });
    return this.withCreators(rows, viewer);
  }

  async createFollowUp(invoiceId: string, dto: CreateFollowUpDto, user: AuthenticatedUser) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const parent = dto.parentId
      ? await this.prisma.debtorFollowUp.findUnique({
          where: { id: dto.parentId },
          select: { id: true, parentId: true, invoiceId: true },
        })
      : null;
    const parentId = dto.parentId
      ? this.threads.rootOf(parent, parent?.invoiceId === invoiceId)
      : null;
    if (!parentId && !dto.type)
      throw new BadRequestException("Choose what kind of follow-up this is");
    const created = await this.prisma.debtorFollowUp.create({
      data: {
        invoiceId,
        parentId,
        type: dto.type ?? "note",
        channel: dto.channel,
        promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : undefined,
        notes: dto.notes,
        createdBy: user.id,
      },
    });
    if (parentId) {
      const thread = await this.prisma.debtorFollowUp.findMany({
        where: { OR: [{ id: parentId }, { parentId }] },
        select: { createdBy: true },
      });
      await this.threads.notifyReply({
        participantIds: thread.map((t) => t.createdBy),
        actor: user,
        where: `invoice ${invoice.invoiceNumber}`,
        body: dto.notes ?? "",
        resourceType: "invoice",
        resourceId: invoiceId,
      });
    }
    return (await this.withCreators([created], user))[0];
  }

  /** The author or the CEO may delete a follow-up; its replies go with it. */
  async removeFollowUp(followUpId: string, user: AuthenticatedUser) {
    const followUp = await this.prisma.debtorFollowUp.findUnique({ where: { id: followUpId } });
    if (!followUp) throw new NotFoundException("Follow-up not found");
    if (followUp.createdBy !== user.id && !isAdminOrCeo(user)) {
      throw new ForbiddenException("You can only delete follow-ups you logged");
    }
    await this.prisma.debtorFollowUp.delete({ where: { id: followUpId } });
    return { id: followUpId };
  }

  private async withCreators<T extends { createdBy: string | null }>(
    rows: T[],
    viewer: AuthenticatedUser,
  ) {
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => !!id))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
    });
    const byId = new Map(users.map((u) => [u.id, maskUserRef(u, viewer)]));
    return rows.map((r) => ({
      ...r,
      creator: r.createdBy ? (byId.get(r.createdBy) ?? null) : null,
    }));
  }
}
