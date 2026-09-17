import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { ImportInvoicesDto } from "./dto/import-invoices.dto";

type RowResult = { row: number; status: "success" | "error"; message: string };

@Injectable()
export class FinanceUploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async importInvoices(dto: ImportInvoicesDto, userId: string) {
    const results: RowResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        if (!row.invoiceNumber) throw new Error("Missing invoice number");
        if (!row.clientName) throw new Error("Missing client name");

        let client = await this.prisma.client.findFirst({ where: { name: row.clientName } });
        if (!client) {
          client = await this.prisma.client.create({
            data: { name: row.clientName, currencyCode: row.currencyCode || "KES" },
          });
        }

        const serviceLine = row.serviceLineCode
          ? await this.prisma.serviceLine.findUnique({ where: { code: row.serviceLineCode } })
          : null;

        const contract = row.contractNumber
          ? await this.prisma.contract.findUnique({ where: { contractNumber: row.contractNumber } })
          : null;
        if (row.contractNumber && !contract)
          throw new Error(`Contract ${row.contractNumber} not found`);
        if (row.serviceLineCode && !serviceLine)
          throw new Error(`Service line code ${row.serviceLineCode} not found`);

        const total = row.subtotal + row.tax;
        const shared = {
          clientId: client.id,
          serviceLineId: serviceLine?.id ?? contract?.serviceLineId ?? undefined,
          contractId: contract?.id,
          issueDate: new Date(row.issueDate),
          dueDate: new Date(row.dueDate),
          currencyCode: row.currencyCode || "KES",
          subtotal: row.subtotal,
          tax: row.tax,
          total,
          directCost: row.directCost,
          status: row.status || "sent",
          isRecurring: row.isRecurring || serviceLine?.isRecurring || false,
          notes: row.notes,
        };
        const invoice = await this.prisma.invoice.upsert({
          where: { invoiceNumber: row.invoiceNumber },
          create: { invoiceNumber: row.invoiceNumber, createdBy: userId, ...shared },
          update: shared,
        });
        let paymentNote = "";
        if (row.amountPaid && row.amountPaid > 0) {
          const paidOn = new Date(row.paidOn || row.issueDate);
          if (Number.isNaN(paidOn.getTime())) throw new Error("Paid on date is not a valid date");
          const exists = await this.prisma.invoicePayment.findFirst({
            where: { invoiceId: invoice.id, amount: row.amountPaid, paidOn },
          });
          if (!exists) {
            await this.prisma.invoicePayment.create({
              data: {
                invoiceId: invoice.id,
                amount: row.amountPaid,
                paidOn,
                reference: row.paymentReference,
                method: "import",
              },
            });
            paymentNote = " with payment";
          }
          const paid = await this.prisma.invoicePayment.aggregate({
            where: { invoiceId: invoice.id },
            _sum: { amount: true },
          });
          const paidTotal = Number(paid._sum.amount ?? 0);
          await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: paidTotal >= total - 0.01 ? "paid" : "partial" },
          });
        }

        successCount++;
        results.push({
          row: i + 2,
          status: "success",
          message: `Imported ${row.invoiceNumber}${paymentNote}`,
        });
      } catch (err) {
        errorCount++;
        results.push({
          row: i + 2,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    await this.prisma.financeUpload.create({
      data: {
        fileName: dto.fileName,
        uploadType: "invoices",
        rowCount: dto.rows.length,
        successCount,
        errorCount,
        errors: results.filter((r) => r.status === "error"),
        uploadedBy: userId,
      },
    });

    return { results, successCount, errorCount };
  }
}
