import "reflect-metadata";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { OpsWaterDataService } from "../src/ops/modules/ops-water-data.service";
import { ReportAccessService } from "../src/reports/report-access.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { DocumentsService } from "../src/documents/documents.service";
import { OpsWaterDocuments } from "../src/ops/modules/ops-water-data.service";

async function verify() {
  const raw = process.env.OPS_TEST_DATABASE_URL;
  if (!raw) throw new Error("Set the isolated verification database URL.");
  const url = new URL(raw);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_verify"));
  const db = new PrismaClient({ datasourceUrl: raw });
  const base = "http://127.0.0.1:4001/api/v1/";
  let checks = 0;
  async function call(path: string, token?: string, method = "GET", body?: unknown) {
    return fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
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
  const ceoAccount = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "ceo@ops-verify.local" } },
  });
  const staffAccount = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "staff@ops-verify.local" } },
  });
  const legacy = new JwtService().sign(
    { sub: ceoAccount.userId },
    { secret: "ops-browser-verification-only", expiresIn: "10m" },
  );
  async function grant(staffId: string, module: string, access: string) {
    const snapshot = await (await call("ops/workspace", ceo)).json();
    const response = await fetch(base + "ops/accounts/" + staffId + "/modules", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + ceo,
        "Content-Type": "application/json",
        "If-Match": String(snapshot.revision),
      },
      body: JSON.stringify({ module, access }),
    });
    assert.equal(response.status, 200, await response.text());
  }
  let postId: string | undefined;
  let zoneId: string | undefined;
  let meterId: string | undefined;
  let uploadId: string | undefined;
  let batchId: string | undefined;
  let expenseId: string | undefined;
  const readingIds: string[] = [];
  try {
    for (const module of ["water", "blog"]) {
      await grant(ceoAccount.id, module, "none");
      await grant(staffAccount.id, module, "none");
    }
    for (const path of ["ops/water/zones", "ops/blog/posts"]) {
      assert.equal((await call(path)).status, 401);
      assert.equal((await call(path, ceo)).status, 403);
      assert.equal((await call(path, staff)).status, 403);
    }
    checks++;
    assert.equal((await call("blog-posts", ceo)).status, 401);
    assert.equal((await call("ops/blog/posts", legacy)).status, 401);
    checks++;
    await grant(staffAccount.id, "water", "view");
    assert.equal((await call("ops/water/zones", staff)).status, 200);
    assert.equal(
      (await call("ops/water/zones", staff, "POST", { name: "Forbidden zone" })).status,
      403,
    );
    assert.equal((await call("ops/blog/posts", staff)).status, 403);
    const snap = await (await call("ops/workspace", staff)).json();
    assert.deepEqual(
      snap.workspace.accounts.find((a: { id: string }) => a.id === staffAccount.id).modules,
      { water: "view" },
    );
    checks++;
    const deniedGrant = await call("ops/accounts/" + staffAccount.id + "/modules", staff, "PUT", {
      module: "blog",
      access: "manage",
    });
    assert.ok([400, 403].includes(deniedGrant.status));
    checks++;
    await grant(ceoAccount.id, "water", "manage");
    const zone = await call("ops/water/zones", ceo, "POST", {
      name: "Migration verify " + Date.now(),
    });
    assert.equal(zone.status, 201, await zone.clone().text());
    zoneId = (await zone.json()).id;
    const meterNumber = "VERIFY-" + Date.now();
    const meterResponse = await call("ops/water/meters", ceo, "POST", {
      meterNumber,
      meterType: "household",
      customerName: "Water verification customer " + meterNumber,
      zoneId,
    });
    assert.equal(meterResponse.status, 201, await meterResponse.clone().text());
    meterId = (await meterResponse.json()).id;
    for (const [readingDate, cumulativeUsage, value] of [
      ["2026-11-01T09:00:00+03:00", 100, 20],
      ["2026-11-10T09:00:00+03:00", 110, 10],
    ] as const) {
      const input = { meterId, readingDate, cumulativeUsage, value };
      const review = await call("ops/water/readings/review", ceo, "POST", input);
      assert.equal(review.status, 201);
      const preview = await review.json();
      const recorded = await call("ops/water/readings", ceo, "POST", {
        ...input,
        reviewToken: preview.reviewToken,
        reviewReason: "Verified synthetic reading values",
      });
      assert.equal(recorded.status, 201, await recorded.clone().text());
      readingIds.push((await recorded.json()).id);
    }
    const usage = await call("ops/water/usage-uploads", ceo, "POST", {
      fileName: "verify-payments.csv",
      vendingSystem: "amsol",
      rows: [
        {
          meterNumber,
          customerName: "Water verification customer " + meterNumber,
          unitsSold: 5,
          amountPaid: 100,
          recordedAt: "2026-11-05T12:00:00+03:00",
        },
      ],
    });
    assert.equal(usage.status, 201, await usage.clone().text());
    uploadId = (await usage.json()).id;
    assert.equal(
      (await db.waterUsageUpload.findUniqueOrThrow({ where: { id: uploadId } })).uploadedBy,
      ceoAccount.userId,
    );
    const expenseResponse = await call("ops/water/expenses", ceo, "POST", {
      expenseDate: "2026-11-05",
      category: "repairs",
      description: "Verification Water repair",
      amount: 25,
    });
    assert.equal(expenseResponse.status, 201);
    expenseId = (await expenseResponse.json()).id;
    assert.equal(
      (
        await call("ops/water/expenses/" + expenseId + "/pay", ceo, "POST", {
          paidOn: "2026-11-05",
        })
      ).status,
      201,
    );
    checks++;
    const csv = new FormData();
    csv.append(
      "file",
      new Blob(["Meter,Date,Remaining balance\n" + meterNumber + ",2026-11-15,8\n"], {
        type: "text/csv",
      }),
      "verify-readings.csv",
    );
    const imported = await call("ops/water/imports", ceo, "POST", csv);
    assert.equal(imported.status, 201);
    batchId = (await imported.json()).id;
    let detail:
      | {
          status: string;
          rows: { id: string; status: string; assessment?: { reviewToken?: string } }[];
          previewToken: string;
        }
      | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      detail = await (await call("ops/water/imports/" + batchId, ceo)).json();
      if (["review", "completed", "failed"].includes(detail.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(detail);
    assert.notEqual(detail.status, "failed", JSON.stringify(detail));
    assert.equal(detail.rows.length, 1);
    assert.equal((await call("ops/water/imports/" + batchId + "/source", staff)).status, 200);
    if (detail.rows[0].status === "pending") {
      const confirmed = await call("ops/water/imports/" + batchId + "/confirm", ceo, "POST", {
        previewToken: detail.previewToken,
        rows: [
          {
            id: detail.rows[0].id,
            reviewToken: detail.rows[0].assessment?.reviewToken,
            reviewReason: "Verified synthetic spreadsheet reading",
          },
        ],
      });
      assert.equal(confirmed.status, 201, await confirmed.clone().text());
    }
    checks++;
    for (const suffix of [
      "zones",
      "dashboard?month=2026-11",
      "reports/summary?month=2026-11",
      "expenses/summary?month=2026-11",
      "customers",
      "meters",
    ]) {
      const mapped = await call("ops/water/" + suffix, ceo);
      const previous = await call("water/" + suffix, legacy);
      assert.equal(mapped.status, 200, suffix + ": " + (await mapped.clone().text()));
      assert.equal(previous.status, 200, suffix + ": " + (await previous.clone().text()));
      assert.deepEqual(await mapped.json(), await previous.json());
    }
    checks++;
    await grant(ceoAccount.id, "blog", "manage");
    await grant(staffAccount.id, "blog", "view");
    const post = await call("ops/blog/posts", ceo, "POST", {
      title: "Migration verification " + Date.now(),
      excerpt: "Verification excerpt",
      authorName: "Migration author",
      tags: ["verification"],
      content:
        '<h2>Water update</h2><p class="drop-cap" style="text-align: center; color: #085599; font-size: 18px">Clean <strong>rich text</strong><script>alert(1)</script></p><table><tbody><tr><td>Volume</td><td>42</td></tr></tbody></table>',
    });
    assert.equal(post.status, 201, await post.clone().text());
    const created = await post.json();
    postId = created.id;
    assert.equal(created.createdBy, ceoAccount.userId);
    assert.ok(created.content.includes("<strong>"));
    assert.ok(created.content.includes("<table>"));
    assert.ok(!created.content.includes("<script>"));
    checks++;
    assert.equal((await call("ops/blog/posts/" + postId, staff)).status, 200);
    for (const action of ["publish", "unpublish", "image", "video"])
      assert.equal(
        (await call("ops/blog/posts/" + postId + "/" + action, staff, "POST")).status,
        403,
      );
    assert.equal((await call("ops/blog/posts/" + postId, staff, "DELETE")).status, 403);
    checks++;
    const form = new FormData();
    form.append(
      "file",
      new Blob(
        [
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ3UAAAAASUVORK5CYII=",
            "base64",
          ),
        ],
        { type: "image/png" },
      ),
      "verify.png",
    );
    assert.equal(
      (await call("ops/blog/posts/" + postId + "/image", ceo, "POST", form)).status,
      201,
    );
    assert.equal((await call("ops/blog/posts/" + postId + "/image", staff)).status, 200);
    assert.equal((await call("public/blog/images/" + postId)).status, 403);
    assert.equal((await call("ops/blog/posts/" + postId + "/publish", ceo, "POST")).status, 201);
    const feed = await call("public/blog/feed", "ops-module-verification-only");
    assert.equal(feed.status, 200);
    const publicPost = (await feed.json()).find((p: { id: string }) => p.id === postId);
    assert.equal(publicPost.slug, created.slug);
    assert.ok(publicPost.content.includes("<strong>"));
    assert.equal(publicPost.cover, "/public/blog/images/" + postId);
    assert.equal((await call("public/blog/images/" + postId)).status, 200);
    checks++;
    await grant(staffAccount.id, "blog", "none");
    assert.equal((await call("ops/blog/posts/" + postId + "/image", staff)).status, 403);
    assert.equal((await call("ops/blog/posts/" + postId, staff)).status, 403);
    checks++;
    assert.equal((await call("ops/water/assistant/chat?context=system", staff)).status, 400);
    assert.equal((await call("ops/water/assistant/chat?context=water", staff)).status, 200);
    const data = new OpsWaterDataService(
      db as PrismaService,
      new OpsWaterDocuments() as unknown as DocumentsService,
      new ReportAccessService(db as PrismaService),
    );
    const user = {
      id: staffAccount.userId!,
      email: "staff@ops-verify.local",
      roles: ["water" as const],
      departmentId: null,
    };
    await assert.rejects(data.query({ model: "OpsStaff", operation: "rows" }, user));
    await assert.rejects(data.query({ model: "PaymentLedgerEntry", operation: "rows" }, user));
    await assert.rejects(data.document());
    const expense = await data.query({ model: "Expense", operation: "count", filters: "{}" }, user);
    assert.equal(
      expense.matchedRecords,
      await db.expense.count({ where: { waterCategory: { not: null }, currencyCode: "KES" } }),
    );
    checks++;
    console.log("Passed " + checks + " migration integration checks.");
  } finally {
    if (postId) await call("ops/blog/posts/" + postId, ceo, "DELETE");
    for (const [kind, id] of [
      ["imports", batchId],
      ["usage-uploads", uploadId],
    ])
      if (id) {
        const preview = await (
          await call("ops/water/" + kind + "/" + id + "/deletion-preview", ceo)
        ).json();
        const removed = await call("ops/water/" + kind + "/" + id, ceo, "DELETE", {
          token: preview.token,
        });
        assert.ok(removed.ok, await removed.text());
      }
    for (const id of readingIds) await call("ops/water/readings/" + id, ceo, "DELETE");
    if (expenseId) await db.expense.delete({ where: { id: expenseId } });
    if (meterId) {
      const meter = await db.waterMeter.findUnique({ where: { id: meterId } });
      await call("ops/water/meters/" + meterId, ceo, "DELETE");
      if (meter?.customerId) await call("ops/water/customers/" + meter.customerId, ceo, "DELETE");
    }
    if (zoneId) await call("ops/water/zones/" + zoneId, ceo, "DELETE");
    for (const module of ["water", "blog"]) {
      await grant(ceoAccount.id, module, "none");
      await grant(staffAccount.id, module, "none");
    }
    await db.$disconnect();
  }
}
void verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
