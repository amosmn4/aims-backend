import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentGatewayService } from "./payment-gateway.service";

const snapshotSchema = z
  .object({
    id: z.string().uuid(),
    receipt: z.string().max(64),
    paybill: z.string().max(32),
    reference: z.string().max(64),
    amount: z
      .string()
      .regex(/^\d{1,10}\.\d{2}$/)
      .nullable(),
    currency: z.string().length(3),
    direction: z.enum(["in", "out"]),
    channel: z.enum(["c2b", "stk", "b2c", "manual"]),
    payment_status: z.enum(["succeeded", "pending", "failed", "refunded"]),
    status: z.enum(["unallocated", "pending", "succeeded", "failed"]),
    destination: z.enum(["water", "external", "unallocated"]),
    destination_name: z.string().max(100),
    application_code: z.string().nullable(),
    payer_name: z.string().max(255),
    payer_phone: z.string().max(64),
    requires_review: z.boolean(),
    transaction_at: z.string().datetime({ offset: true }).nullable(),
    received_at: z.string().datetime({ offset: true }),
  })
  .passthrough();
const batchSchema = z.object({
  changes: z
    .array(
      z.object({
        sequence: z.string().regex(/^[1-9]\d*$/),
        event_id: z.string().uuid(),
        snapshot: snapshotSchema,
      }),
    )
    .max(100),
});
const SOURCE = "water-paybill";

@Injectable()
export class PaymentLedgerSyncService {
  private readonly logger = new Logger(PaymentLedgerSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayService,
  ) {}

  status() {
    return this.prisma.paymentLedgerSync.findUnique({ where: { id: SOURCE } }).then((state) => ({
      configured: this.gateway.configured,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastError: state?.lastError ?? null,
    }));
  }

  @Interval(30000)
  async scheduledSync() {
    if (!this.gateway.configured) return;
    try {
      await this.sync();
    } catch {
      this.logger.warn("Payment ledger synchronization failed; pending changes will be retried.");
    }
  }

  async sync() {
    if (!this.gateway.configured) return { configured: false, imported: 0 };
    await this.prisma.paymentLedgerSync.upsert({
      where: { id: SOURCE },
      create: { id: SOURCE },
      update: {},
    });
    const leaseToken = randomUUID();
    const lease = await this.prisma.paymentLedgerSync.updateMany({
      where: {
        id: SOURCE,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 120000) },
    });
    if (!lease.count) return { busy: true, imported: 0 };
    let imported = 0;
    try {
      for (let page = 0; page < 10; page++) {
        const batch = batchSchema.parse(await this.gateway.request("changes/"));
        if (!batch.changes.length) break;
        await this.prisma.$transaction(
          async (tx) => {
            const renewed = await tx.paymentLedgerSync.updateMany({
              where: { id: SOURCE, leaseToken },
              data: { leaseUntil: new Date(Date.now() + 120000) },
            });
            if (!renewed.count) throw new Error("The payment ledger sync lease expired.");
            for (const change of batch.changes) {
              const s = change.snapshot;
              if (s.id !== change.event_id)
                throw new Error("Payment ledger snapshot identity mismatch.");
              const data = {
                receipt: s.receipt,
                paybill: s.paybill,
                reference: s.reference,
                amount: s.amount === null ? null : new Prisma.Decimal(s.amount),
                currency: s.currency,
                direction: s.direction,
                channel: s.channel,
                paymentStatus: s.payment_status,
                processingStatus: s.status,
                destination: s.destination,
                systemName: s.destination_name,
                applicationCode: s.application_code,
                payerName: s.payer_name,
                payerPhone: s.payer_phone,
                requiresReview: s.requires_review,
                transactionAt: s.transaction_at ? new Date(s.transaction_at) : null,
                receivedAt: new Date(s.received_at),
                sourceSequence: BigInt(change.sequence),
                snapshot: s as Prisma.InputJsonObject,
                syncedAt: new Date(),
              };
              await tx.paymentLedgerEntry.upsert({
                where: { id: s.id },
                create: { id: s.id, ...data },
                update: data,
              });
            }
          },
          { timeout: 30000 },
        );
        await this.gateway.request("changes/", "POST", {
          acknowledged: batch.changes.map((c) => c.sequence),
        });
        imported += batch.changes.length;
      }
      await this.prisma.paymentLedgerSync.updateMany({
        where: { id: SOURCE, leaseToken },
        data: { lastSuccessAt: new Date(), lastError: null },
      });
      return { configured: true, imported };
    } catch (error) {
      await this.prisma.paymentLedgerSync.updateMany({
        where: { id: SOURCE, leaseToken },
        data: {
          lastError:
            "Synchronization failed. Saved entries remain available; pending updates will retry.",
        },
      });
      throw error;
    } finally {
      await this.prisma.paymentLedgerSync.updateMany({
        where: { id: SOURCE, leaseToken },
        data: { leaseToken: null, leaseUntil: null },
      });
    }
  }
}
