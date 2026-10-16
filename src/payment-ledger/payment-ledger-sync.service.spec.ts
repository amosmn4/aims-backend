import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../prisma/prisma.service";
import type { PaymentGatewayService } from "./payment-gateway.service";
import { PaymentLedgerSyncService } from "./payment-ledger-sync.service";

const snapshot = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  receipt: "MPESA123",
  paybill: "123456",
  reference: "SHOP-123",
  amount: "120.00",
  currency: "KES",
  direction: "in",
  channel: "stk",
  payment_status: "succeeded",
  status: "succeeded",
  destination: "external",
  destination_name: "Website Shop",
  application_code: "shop",
  payer_name: "Buyer",
  payer_phone: "254700000000",
  requires_review: false,
  transaction_at: null,
  received_at: "2026-10-15T10:00:00Z",
  raw_payload: { original: "retained" },
  notifications: [{ source: "stk" }],
  dispatch: null,
};

describe("Durable AIMS ledger synchronization", () => {
  const request = jest.fn<(path: string, method?: string, body?: unknown) => Promise<unknown>>();
  const state = {
    upsert: jest.fn<(input: unknown) => Promise<unknown>>(),
    updateMany: jest.fn<(input: unknown) => Promise<{ count: number }>>(),
    findUnique: jest.fn(),
  };
  const entries = {
    upsert: jest.fn<(input: unknown) => Promise<unknown>>(),
    updateMany: jest.fn<(input: unknown) => Promise<{ count: number }>>(),
  };
  const tx = { paymentLedgerSync: state, paymentLedgerEntry: entries };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  const service = new PaymentLedgerSyncService(prisma, {
    configured: true,
    request,
  } as unknown as PaymentGatewayService);
  beforeEach(() => {
    jest.clearAllMocks();
    state.updateMany.mockResolvedValue({ count: 1 });
    entries.upsert.mockResolvedValue({});
    entries.updateMany.mockResolvedValue({ count: 1 });
  });

  function batch(sequence = "9007199254740993") {
    return { changes: [{ sequence, event_id: snapshot.id, snapshot }] };
  }

  it("stores full payloads and exact sequence numbers before acknowledging", async () => {
    request.mockImplementation(async (path, method) => {
      if (method === "POST") {
        expect(entries.upsert).toHaveBeenCalled();
        return {};
      }
      return request.mock.calls.filter((call) => call[1] !== "POST").length === 1
        ? batch()
        : { changes: [] };
    });
    expect(await service.sync()).toEqual({ configured: true, imported: 1 });
    expect(entries.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sourceSequence: 9007199254740993n,
          snapshot: expect.objectContaining({
            raw_payload: snapshot.raw_payload,
            notifications: snapshot.notifications,
          }),
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith("changes/", "POST", {
      acknowledged: ["9007199254740993"],
    });
    expect(entries.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ sourceSequence: 9007199254740993n }),
      }),
    );
  });

  it("does not acknowledge when persistence fails", async () => {
    request.mockResolvedValue(batch());
    entries.upsert.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(service.sync()).rejects.toThrow("Database unavailable");
    expect(request.mock.calls.some((call) => call[1] === "POST")).toBe(false);
    expect(state.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { leaseToken: null, leaseUntil: null } }),
    );
  });

  it("imports a late commit even when its queue ID is lower than an earlier batch", async () => {
    request
      .mockResolvedValueOnce(batch("2"))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        changes: [
          {
            ...batch("1").changes[0],
            snapshot: { ...snapshot, payer_name: "Latest committed name" },
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ changes: [] });
    expect(await service.sync()).toEqual({ configured: true, imported: 2 });
    expect(entries.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: snapshot.id },
        update: expect.objectContaining({
          sourceSequence: 1n,
          payerName: "Latest committed name",
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith("changes/", "POST", {
      acknowledged: ["1"],
    });
  });

  it("does not persist or acknowledge after losing the worker lease", async () => {
    request.mockResolvedValue(batch());
    state.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(service.sync()).rejects.toThrow("lease expired");
    expect(entries.upsert).not.toHaveBeenCalled();
    expect(request.mock.calls.some((call) => call[1] === "POST")).toBe(false);
  });

  it("rejects malformed snapshots without acknowledging them", async () => {
    request.mockResolvedValue({
      changes: [{ ...batch().changes[0], snapshot: { ...snapshot, amount: "invalid" } }],
    });
    await expect(service.sync()).rejects.toThrow();
    expect(entries.upsert).not.toHaveBeenCalled();
    expect(request.mock.calls.some((call) => call[1] === "POST")).toBe(false);
  });

  it("allows retry after acknowledgment delivery fails", async () => {
    request.mockImplementation(async (_path, method) => {
      if (method === "POST") throw new Error("Gateway timeout");
      return batch();
    });
    await expect(service.sync()).rejects.toThrow("Gateway timeout");
    expect(entries.upsert).toHaveBeenCalledTimes(1);
    expect(state.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.any(String) }),
      }),
    );
  });

  it("does not run a second worker while another holds the lease", async () => {
    state.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await service.sync()).toEqual({ busy: true, imported: 0 });
    expect(request).not.toHaveBeenCalled();
  });
});
