import { describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { ledgerFilters, PaymentLedgerService } from "./payment-ledger.service";
import type { PaymentLedgerAccessService } from "./payment-ledger-access.service";
import type { PaymentGatewayService } from "./payment-gateway.service";

describe("Payment ledger filtering and API enforcement", () => {
  it("uses inclusive Nairobi calendar dates", () => {
    const { where } = ledgerFilters({ from: "2026-10-15", to: "2026-10-15" });
    expect(where.receivedAt).toEqual({
      gte: new Date("2026-10-14T21:00:00Z"),
      lt: new Date("2026-10-15T21:00:00Z"),
    });
  });

  it.each([
    { from: "2026-10-16", to: "2026-10-15" },
    { from: "2026-02-30" },
    { pageSize: "101" },
    { status: "paid" },
  ])("rejects invalid filters %p", (query) => {
    expect(() => ledgerFilters(query)).toThrow(BadRequestException);
  });

  it("combines payment and routing filters without treating a failed delivery as a failed payment", () => {
    expect(
      ledgerFilters({
        paymentStatus: "succeeded",
        status: "failed",
        system: "Shop",
        review: "true",
      }).where,
    ).toEqual({
      paymentStatus: "succeeded",
      processingStatus: "failed",
      systemName: "Shop",
      requiresReview: true,
    });
  });

  it("blocks database reads, exports, and gateway writes before performing any operation", async () => {
    const access = {
      assert: jest.fn<() => Promise<void>>().mockRejectedValue(new ForbiddenException()),
    } as unknown as PaymentLedgerAccessService;
    const gateway = { request: jest.fn() } as unknown as PaymentGatewayService;
    const service = new PaymentLedgerService({} as PrismaService, access, gateway);
    const user = {
      id: "staff",
      email: "staff@example.com",
      roles: [] as [],
      departmentId: null,
    };
    await expect(service.list(user, {})).rejects.toThrow(ForbiddenException);
    await expect(service.csv(user, {})).rejects.toThrow(ForbiddenException);
    await expect(service.bridge(user, "applications/", "POST", {})).rejects.toThrow(
      ForbiddenException,
    );
    expect(gateway.request).not.toHaveBeenCalled();
  });
});
