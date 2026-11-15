import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";

export const ledgerFixtureIds = {
  allocation: "11111111-1111-4111-8111-111111111111",
  retry: "22222222-2222-4222-8222-222222222222",
  units: "33333333-3333-4333-8333-333333333333",
  application: "44444444-4444-4444-8444-444444444444",
  meter: "55555555-5555-4555-8555-555555555555",
};
function snapshot(
  id: string,
  receipt: string,
  amount: string | null,
  direction = "in",
  currency = "KES",
) {
  return {
    id,
    receipt,
    amount,
    currency,
    direction,
    provider: "fixture",
    paybill: "600001",
    reference: "VERIFY-ACCOUNT",
    channel: "c2b",
    payment_status: "succeeded",
    status: "unallocated",
    destination: "unallocated",
    destination_name: "Unallocated",
    application_code: null,
    payer_name: "Ledger fixture payer",
    payer_phone: "+254700000000",
    requires_review: true,
    transaction_at: "2026-11-10T09:00:00+03:00",
    received_at: "2026-11-10T09:00:00+03:00",
    processed_at: null,
    meter_number: null,
    water_tokens: [],
    metadata: {},
    raw_payload: { fixture: true },
    notifications: [],
    intent_detail: null,
    history: [],
    water_payment_detail: null,
    error_message: "",
    dispatch: null as null | {
      status: string;
      attempt_count: number;
      next_retry_at: null;
      attempts: unknown[];
    },
  };
}
export async function startLedgerFixture(db: PrismaClient) {
  const allocation = snapshot(ledgerFixtureIds.allocation, "VERIFY-ALLOC", "125.50");
  const retry = {
    ...snapshot(ledgerFixtureIds.retry, "VERIFY-RETRY", "15.00", "out", "USD"),
    status: "failed",
    destination: "external",
    destination_name: "Fixture service",
    application_code: "fixture",
    requires_review: false,
    dispatch: {
      status: "failed",
      attempt_count: 3,
      next_retry_at: null,
      attempts: [{ request: { fixture: true }, response: { status: 503 } }],
    },
  };
  const units = {
    ...snapshot(ledgerFixtureIds.units, "VERIFY-UNITS", null),
    destination: "water",
    destination_name: "Water",
    status: "succeeded",
    requires_review: false,
    metadata: { vend_by_units: true, units: 5 },
  };
  const entries = new Map([allocation, retry, units].map((entry) => [entry.id, entry]));
  for (const entry of entries.values()) {
    const data = {
      receipt: entry.receipt,
      paybill: entry.paybill,
      reference: entry.reference,
      amount: entry.amount,
      currency: entry.currency,
      direction: entry.direction,
      channel: entry.channel,
      paymentStatus: entry.payment_status,
      processingStatus: entry.status,
      destination: entry.destination,
      systemName: entry.destination_name,
      applicationCode: entry.application_code,
      payerName: entry.payer_name,
      payerPhone: entry.payer_phone,
      requiresReview: entry.requires_review,
      transactionAt: new Date(entry.transaction_at),
      receivedAt: new Date(entry.received_at),
      sourceSequence: 9007199254740993n,
      snapshot: entry as unknown as Prisma.InputJsonObject,
    };
    await db.paymentLedgerEntry.upsert({
      where: { id: entry.id },
      create: { id: entry.id, ...data },
      update: data,
    });
  }
  const apps = [
    {
      id: ledgerFixtureIds.application,
      name: "Fixture service",
      code: "fixture",
      paybill: "600001",
      reference_prefix: "FIX",
      callback_url: "https://fixture.invalid/callback",
      is_active: true,
    },
  ];
  const requests: { path: string; method: string; body: unknown }[] = [];
  const changes = new Map<string, { sequence: string; event_id: string; snapshot: unknown }>();
  let sequence = 9007199254740993n;
  let fail = false;
  let runtimeWorkers = 0;
  let keyGeneration = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1:4003");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/__verify/requests") return send(200, { requests, runtimeWorkers });
      if (url.pathname === "/__verify/fail") {
        fail = body.fail === true;
        return send(200, { fail });
      }
      if (req.headers.authorization !== "Aims-Key ops-ledger-fixture-only")
        return send(401, { error: "Fixture key required" });
      const path = url.pathname.replace("/api/payment-gateway/aims/", "");
      requests.push({ path, method: req.method ?? "GET", body });
      if (fail) return send(503, { error: "Fixture gateway unavailable" });
      if (path === "changes/") {
        if (req.method === "GET") return send(200, { changes: [...changes.values()] });
        for (const id of body.acknowledged ?? []) changes.delete(id);
        return send(200, { acknowledged: true });
      }
      if (path === "meters/")
        return send(200, [{ id: ledgerFixtureIds.meter, meter_number: "VERIFY-METER" }]);
      if (path === "applications/") {
        if (req.method === "GET") return send(200, apps);
        if (
          !body.actor?.id ||
          !body.data?.name ||
          !String(body.data.callback_url).startsWith("https://")
        )
          return send(400, { error: "Provide an actor, system name and HTTPS callback" });
        const app = { ...body.data, id: randomUUID() };
        apps.push(app);
        keyGeneration++;
        return send(200, {
          ...app,
          api_key: "fixture-api-key-" + keyGeneration,
          signing_secret: "fixture-signing-secret-" + keyGeneration,
        });
      }
      const application = /^applications\/([a-f0-9-]+)\/$/.exec(path);
      if (application) {
        const app = apps.find((row) => row.id === application[1]);
        if (!app) return send(404, { error: "Application not found" });
        if (!body.actor?.id) return send(400, { error: "Actor required" });
        if (req.method === "PATCH") {
          Object.assign(app, body.data);
          return send(200, app);
        }
        keyGeneration++;
        return send(200, {
          api_key: "fixture-api-key-" + keyGeneration,
          signing_secret: "fixture-signing-secret-" + keyGeneration,
        });
      }
      const action = /^events\/([a-f0-9-]+)\/(allocate|retry)\/$/.exec(path);
      if (action) {
        const entry = entries.get(action[1]);
        if (!entry) return send(404, { error: "Payment not found" });
        if (!body.actor?.id || String(body.data?.reason ?? "").length < 5)
          return send(400, { error: "Actor and reason required" });
        if (action[2] === "allocate")
          Object.assign(entry, {
            destination: body.data.destination,
            destination_name: body.data.destination === "water" ? "Water" : "Fixture service",
            meter_number: body.data.meter_id ? "VERIFY-METER" : null,
          });
        Object.assign(entry, {
          status: "pending",
          requires_review: false,
          dispatch: { status: "pending", attempt_count: 0, next_retry_at: null, attempts: [] },
        });
        const number = String(++sequence);
        changes.set(number, {
          sequence: number,
          event_id: entry.id,
          snapshot: structuredClone(entry),
        });
        return send(200, entry);
      }
      return send(404, { error: "Unknown fixture route" });
    } catch {
      return send(500, { error: "Fixture request failed" });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4003, "127.0.0.1", resolve);
  });
  return {
    setRuntimeWorkers: (count: number) => {
      runtimeWorkers = count;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
