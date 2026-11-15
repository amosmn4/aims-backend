import "reflect-metadata";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { ledgerFixtureIds as ids } from "./ops-ledger-fixture";

async function verify() {
  const raw = process.env.OPS_TEST_DATABASE_URL;
  if (!raw) throw new Error("Set the isolated verification database URL.");
  const url = new URL(raw);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_verify"));
  const db = new PrismaClient({ datasourceUrl: raw });
  const base = "http://127.0.0.1:4001/api/v1/";
  const gateway = "http://127.0.0.1:4003/__verify/";
  let checks = 0;
  async function call(path: string, token?: string, method = "GET", data?: unknown) {
    return fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  }
  async function login(email: string) {
    const response = await call("ops/auth/login", undefined, "POST", {
      email,
      password: "OpsBrowser2026!",
      remember: false,
    });
    assert.equal(response.status, 200);
    return (await response.json()).accessToken as string;
  }
  const ceo = await login("ceo@ops-verify.local");
  const staff = await login("staff@ops-verify.local");
  const owner = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "ceo@ops-verify.local" } },
  });
  const viewer = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "staff@ops-verify.local" } },
  });
  const legacy = new JwtService().sign(
    { sub: owner.userId },
    { secret: "ops-browser-verification-only", expiresIn: "10m" },
  );
  const legacyGrants = await db.resourceAccessGrant.findMany({ orderBy: { id: "asc" } });
  const started = new Date();
  async function grant(id: string, access: string) {
    const snapshot = await (await call("ops/workspace", ceo)).json();
    const response = await fetch(base + "ops/accounts/" + id + "/modules", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + ceo,
        "Content-Type": "application/json",
        "If-Match": String(snapshot.revision),
      },
      body: JSON.stringify({ module: "ledger", access }),
    });
    assert.equal(response.status, 200, await response.text());
  }
  async function gatewayFailure(fail: boolean) {
    await fetch(gateway + "fail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fail }),
    });
  }
  async function successful(path: string, method = "GET", data?: unknown) {
    const response = await call("ops/payment-ledger/" + path, staff, method, data);
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify({ path, status: response.status, result }));
    return result;
  }
  try {
    await grant(owner.id, "none");
    await grant(viewer.id, "none");
    assert.equal((await call("ops/payment-ledger/entries")).status, 401);
    for (const token of [ceo, staff]) {
      for (const path of [
        "entries",
        "entries/summary",
        "entries/export",
        "entries/" + ids.allocation,
        "sync",
        "access",
      ]) {
        assert.equal((await call("ops/payment-ledger/" + path, token)).status, 403);
      }
    }
    checks++;
    assert.equal((await call("payment-ledger/entries", staff)).status, 401);
    assert.equal((await call("ops/payment-ledger/entries", legacy)).status, 401);
    assert.equal((await call("payment-ledger/entries", legacy)).status, 200);
    checks++;
    await grant(viewer.id, "view");
    assert.deepEqual(await successful("access"), { read: true, write: false, manageAccess: false });
    for (const path of [
      "entries?q=VERIFY-",
      "entries/summary?q=VERIFY-",
      "entries/" + ids.allocation,
      "entries/export?q=VERIFY-",
    ]) {
      const ops = await call("ops/payment-ledger/" + path, staff);
      const old = await call("payment-ledger/" + path, legacy);
      assert.equal(ops.status, 200);
      assert.match(ops.headers.get("cache-control") ?? "", /private.*no-store/);
      assert.equal(await ops.text(), await old.text());
    }
    checks++;
    const summary = await successful("entries/summary?q=VERIFY-&from=2026-11-10&to=2026-11-10");
    assert.equal(summary.count, 3);
    assert.equal(summary.totals.length, 2);
    assert.equal(
      summary.totals.find((row: { currency: string }) => row.currency === "KES")._sum.amount,
      "125.5",
    );
    assert.equal(
      summary.totals.find((row: { currency: string }) => row.currency === "USD").direction,
      "out",
    );
    assert.equal((await successful("entries?q=VERIFY-&from=2026-11-11")).total, 0);
    assert.equal(
      (await successful("entries?q=VERIFY-&direction=out&paymentStatus=succeeded")).total,
      1,
    );
    assert.equal((await successful("entries/" + ids.units)).amount, null);
    checks++;
    for (const [path, method] of [
      ["entries/" + ids.allocation + "/allocate", "POST"],
      ["entries/" + ids.retry + "/retry", "POST"],
      ["sync", "POST"],
      ["meters", "GET"],
      ["applications", "GET"],
      ["applications", "POST"],
      ["applications/" + ids.application, "PATCH"],
      ["applications/" + ids.application + "/rotate-credentials", "POST"],
    ])
      assert.equal(
        (await call("ops/payment-ledger/" + path, staff, method, method === "GET" ? undefined : {}))
          .status,
        403,
      );
    checks++;
    await grant(viewer.id, "manage");
    assert.deepEqual(await successful("access"), { read: true, write: true, manageAccess: false });
    assert.equal(
      (await successful("meters?search=VERIFY&paybill=600001"))[0].meter_number,
      "VERIFY-METER",
    );
    assert.equal((await successful("applications"))[0].id, ids.application);
    const app = await successful("applications", "POST", {
      name: "Verifier service",
      code: "verifier",
      paybill: "600001",
      reference_prefix: "VER",
      callback_url: "https://fixture.invalid/verifier",
      is_active: true,
    });
    assert.match(app.api_key, /^fixture-api-key-/);
    assert.equal(
      (
        await successful("applications/" + app.id, "PATCH", {
          name: "Updated verifier",
          is_active: false,
        })
      ).name,
      "Updated verifier",
    );
    assert.match(
      (await successful("applications/" + app.id + "/rotate-credentials", "POST", {}))
        .signing_secret,
      /^fixture-signing-secret-/,
    );
    checks++;
    const allocated = await successful("entries/" + ids.allocation + "/allocate", "POST", {
      destination: "water",
      meter_id: ids.meter,
      reason: "Isolated allocation verification",
    });
    assert.equal(allocated.destination, "water");
    assert.equal(allocated.meter_number, "VERIFY-METER");
    assert.equal(
      (
        await successful("entries/" + ids.retry + "/retry", "POST", {
          reason: "Isolated retry verification",
        })
      ).dispatch.status,
      "pending",
    );
    await successful("sync", "POST");
    const stored = await db.paymentLedgerEntry.findUniqueOrThrow({ where: { id: ids.allocation } });
    assert.equal(stored.destination, "water");
    assert.ok(stored.sourceSequence > 9007199254740993n);
    checks++;
    const runtime = await (await fetch(gateway + "requests")).json();
    assert.equal(runtime.runtimeWorkers, 1);
    const writes = runtime.requests.filter(
      (row: { path: string; method: string }) => row.method !== "GET" && row.path !== "changes/",
    );
    assert.ok(writes.length >= 5);
    for (const write of writes) {
      assert.equal(write.body.actor.id, viewer.userId);
      assert.notEqual(write.body.actor.id, viewer.id);
    }
    assert.ok(
      runtime.requests.some(
        (row: { path: string; method: string; body: { acknowledged?: string[] } }) =>
          row.path === "changes/" &&
          row.method === "POST" &&
          row.body.acknowledged?.some((value) => BigInt(value) > 9007199254740993n),
      ),
    );
    const audits = await db.auditLog.findMany({
      where: { entityType: "payment-ledger", createdAt: { gte: started } },
    });
    assert.ok(audits.length >= 5);
    assert.ok(audits.every((row) => row.userId === viewer.userId));
    checks++;
    await gatewayFailure(true);
    assert.equal((await call("ops/payment-ledger/applications", staff)).status, 502);
    assert.equal((await successful("entries?q=VERIFY-")).total, 3);
    assert.equal((await successful("entries/" + ids.allocation)).receipt, "VERIFY-ALLOC");
    assert.equal((await call("ops/payment-ledger/entries/export", staff)).status, 200);
    checks++;
    await grant(viewer.id, "none");
    assert.equal((await call("ops/payment-ledger/entries", staff)).status, 403);
    assert.equal((await call("ops/payment-ledger/entries/export", staff)).status, 403);
    assert.deepEqual(
      await db.resourceAccessGrant.findMany({ orderBy: { id: "asc" } }),
      legacyGrants,
    );
    checks++;
    console.log(
      JSON.stringify({
        ledgerIntegrationChecks: checks,
        mockGatewayOnly: true,
        sharedSyncWorkers: runtime.runtimeWorkers,
      }),
    );
  } finally {
    await gatewayFailure(false);
    await grant(owner.id, "none");
    await grant(viewer.id, "none");
    await db.$disconnect();
  }
}
void verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
