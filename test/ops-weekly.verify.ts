import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { defaultWeeklySettings } from "../src/ops/weekly/weekly-calendar";

async function verify() {
  const raw = process.env.OPS_TEST_DATABASE_URL;
  if (!raw) throw new Error("Set the isolated verification database URL.");
  const url = new URL(raw);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_verify"));
  const db = new PrismaClient({ datasourceUrl: raw });
  const base = "http://127.0.0.1:4001/api/v1/ops/weekly/";
  const control = "http://127.0.0.1:2527";
  const week = "2026-11-16";
  const nextWeek = "2026-11-23";
  const projectId = randomUUID();
  const ownTask = randomUUID();
  const otherTask = randomUUID();
  const created = new Set<string>();
  let checks = 0;
  async function login(email: string) {
    const response = await fetch("http://127.0.0.1:4001/api/v1/ops/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "OpsBrowser2026!", remember: false }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).accessToken as string;
  }
  const ceo = await login("ceo@ops-verify.local");
  const staff = await login("staff@ops-verify.local");
  const outsider = await login("it@ops-verify.local");
  const owner = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "ceo@ops-verify.local" } },
  });
  const person = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "staff@ops-verify.local" } },
  });
  const other = await db.opsStaff.findFirstOrThrow({
    where: { user: { email: "it@ops-verify.local" } },
  });
  const oldSettings = await db.opsWeeklySettings.findUnique({ where: { id: "workspace" } });
  assert.equal(
    await db.opsWeeklyReport.count({
      where: { staffId: person.id, weekStart: { in: [week, nextWeek] } },
    }),
    0,
    "Choose unused isolated report fixtures.",
  );
  const priorDeliveries = await db.opsWeeklyDelivery.findMany({ select: { id: true } });
  const previousIds = new Set(priorDeliveries.map((row) => row.id));
  async function call(path: string, token = ceo, method = "GET", body?: unknown) {
    return fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function json(path: string, token = ceo, method = "GET", body?: unknown) {
    const response = await call(path, token, method, body);
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify({ path, status: response.status, result }));
    return result;
  }
  async function settings(value: unknown) {
    const current = await json("settings");
    return json("settings", ceo, "PUT", { version: current.version, settings: value });
  }
  async function fixture(path: string, value?: unknown) {
    return (
      await fetch(control + path, {
        ...(value !== undefined
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value),
            }
          : {}),
      })
    ).json();
  }
  const configured = {
    ...defaultWeeklySettings(),
    startWeek: week,
    planEmailEnabled: true,
    reportEmailEnabled: false,
  };
  const items = [
    {
      id: randomUUID(),
      taskId: ownTask,
      title: "Prepare the weekly client pack",
      detail: "Send the reviewed pack",
      status: "planned",
    },
    {
      id: randomUUID(),
      title: "Review <script>alert('fixture')</script> audit & support",
      detail: "Escape names and text in email",
      status: "planned",
    },
  ];
  const draft = {
    summary: "PRIVATE DRAFT fixture",
    items,
    blockers: "",
    nextWeek: "",
    noWorkReason: "",
  };
  try {
    await db.opsProject.create({
      data: {
        id: projectId,
        name: "Weekly verification only",
        lead: person.id,
        status: "on-track",
        stage: "In progress",
        progress: 0,
        due: "2026-11-30",
        summary: "Isolated reporting fixtures",
        members: { create: [{ personId: person.id }, { personId: other.id }] },
        departments: { create: { deptId: "hr" } },
      },
    });
    await db.opsTask.createMany({
      data: [
        {
          id: ownTask,
          title: "Owned fixture task",
          project: projectId,
          assignee: person.id,
          due: "2026-11-20",
          priority: "Medium",
          status: "In progress",
        },
        {
          id: otherTask,
          title: "Other staff task",
          project: projectId,
          assignee: other.id,
          due: "2026-11-20",
          priority: "Medium",
          status: "To do",
        },
      ],
    });
    assert.equal((await call("settings", "")).status, 401);
    assert.equal(
      (await call("settings", staff, "PUT", { version: 0, settings: configured })).status,
      403,
    );
    assert.equal((await call(`brief?week=${week}&phase=plan`, staff)).status, 403);
    await settings(configured);
    const version = (await json("settings")).version;
    assert.equal(
      (await call("settings", ceo, "PUT", { version: version - 1, settings: configured })).status,
      409,
    );
    assert.equal((await call("reports?week=2026-11-17", staff)).status, 400);
    checks++;
    assert.equal(
      (
        await call(`reports/${week}/plan`, staff, "PUT", {
          version: 0,
          submit: true,
          submission: { ...draft, items: [], noWorkReason: "" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`reports/${week}/plan`, staff, "PUT", {
          version: 0,
          submit: false,
          submission: { ...draft, items: [{ ...items[0], taskId: otherTask }] },
        })
      ).status,
      403,
    );
    const saved = await json(`reports/${week}/plan`, staff, "PUT", {
      version: 0,
      submit: false,
      submission: draft,
    });
    created.add(saved.id);
    assert.equal(saved.version, 1);
    assert.equal((await call(`reports/${week}/${person.id}`, outsider)).status, 404);
    const hidden = await json(`reports/${week}/${person.id}`);
    assert.equal(hidden.plan.submission.summary, "");
    assert.equal(hidden.plan.submission.items.length, 0);
    const own = await json(`reports/${week}/${person.id}`, staff);
    assert.equal(own.plan.submission.summary, draft.summary);
    assert.match(
      (await call(`reports?week=${week}`, staff)).headers.get("cache-control") ?? "",
      /private.*no-store/,
    );
    checks++;
    const plan = { ...draft, summary: "Public weekly plan fixture & support" };
    const submitted = await json(`reports/${week}/plan`, staff, "PUT", {
      version: 1,
      submit: true,
      submission: plan,
    });
    assert.equal(submitted.version, 2);
    assert.equal(
      (
        await call(`reports/${week}/plan`, staff, "PUT", {
          version: 2,
          submit: false,
          submission: draft,
        })
      ).status,
      409,
    );
    const preview = await json(`brief?week=${week}&phase=plan`);
    assert.ok(preview.html.includes("Public weekly plan fixture"));
    assert.ok(!preview.html.includes("PRIVATE DRAFT"));
    assert.ok(!preview.html.includes("<script>"));
    assert.ok(preview.html.includes("&amp; support"));
    assert.ok(preview.html.includes("phase=plan"));
    assert.ok(preview.html.includes(other.name));
    assert.ok(preview.html.includes("Not submitted"));
    checks++;
    const report = {
      ...plan,
      summary: "Weekly results fixture",
      items: items.map((item, index) => ({
        ...item,
        status: index === 0 ? "completed" : "pending",
        detail: "Weekly outcome notes",
      })),
      nextWeek: "Carry forward the pending task",
    };
    assert.equal(
      (
        await call(`reports/${week}/report`, staff, "PUT", {
          version: 0,
          submit: true,
          submission: { ...report, items: report.items.slice(0, 1) },
        })
      ).status,
      400,
    );
    await db.opsTask.update({ where: { id: ownTask }, data: { assignee: other.id } });
    const resultDraft = await json(`reports/${week}/report`, staff, "PUT", {
      version: 0,
      submit: false,
      submission: report,
    });
    created.add(resultDraft.id);
    assert.equal(
      (
        await call(`reports/${week}/report`, staff, "PUT", {
          version: 0,
          submit: false,
          submission: report,
        })
      ).status,
      409,
    );
    await json(`reports/${week}/report`, staff, "PUT", {
      version: 1,
      submit: true,
      submission: report,
    });
    const results = await json(`reports/${week}/${person.id}`);
    assert.equal(results.report.counts.completed, 1);
    assert.equal(results.report.counts.pending, 1);
    assert.equal(
      (
        await call(`reports/${nextWeek}/report`, staff, "PUT", {
          version: 0,
          submit: true,
          submission: { ...report, items: [] },
        })
      ).status,
      400,
    );
    checks++;
    assert.equal(
      (
        await call(`submissions/${resultDraft.id}/review`, staff, "POST", {
          version: 2,
          comment: "Forbidden review",
        })
      ).status,
      403,
    );
    await json(`submissions/${resultDraft.id}/review`, ceo, "POST", {
      version: 2,
      comment: "Reviewed the results",
    });
    await json(`submissions/${resultDraft.id}/return`, ceo, "POST", {
      version: 3,
      comment: "Explain the pending task before approval",
    });
    const history = await json(`submissions/${resultDraft.id}/history`, staff);
    assert.ok(
      history.some(
        (entry: { newValue: { previousSubmission?: { summary: string } } }) =>
          entry.newValue.previousSubmission?.summary === report.summary,
      ),
    );
    await json(`reports/${week}/report`, staff, "PUT", {
      version: 4,
      submit: true,
      submission: { ...report, blockers: "Waiting for client input" },
    });
    checks++;
    const before = (await fixture("/messages")).messages.length;
    const ceos = await db.opsStaff.count({
      where: { role: "ceo", active: true, user: { isActive: true, passwordHash: { not: null } } },
    });
    await fixture("/tick", {});
    const plans = await fixture("/messages");
    assert.equal(plans.messages.length - before, ceos);
    assert.ok(
      plans.messages.every((mail: { recipients: string[] }) =>
        mail.recipients.every(
          (address) =>
            !address.includes("staff@ops-verify.local") && !address.includes("it@ops-verify.local"),
        ),
      ),
    );
    await fixture("/tick", {});
    assert.equal((await fixture("/messages")).messages.length, plans.messages.length);
    const deliveries = await db.opsWeeklyDelivery.findMany({
      where: { recipientId: owner.id, weekStart: week },
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].phase, "plan");
    assert.equal(deliveries[0].status, "sent");
    checks++;
    await settings({ ...configured, reportEmailEnabled: true });
    await fixture("/tick", {});
    const reports = await fixture("/messages");
    assert.equal(reports.messages.length - plans.messages.length, ceos);
    const ownReport = await db.opsWeeklyDelivery.findFirstOrThrow({
      where: { recipientId: owner.id, weekStart: week, phase: "report" },
    });
    assert.equal(ownReport.status, "sent");
    assert.ok(ownReport.html.includes("Weekly results fixture"));
    assert.ok(!ownReport.html.includes("Public weekly plan fixture"));
    assert.ok(ownReport.html.includes("phase=report"));
    await fixture("/tick", {});
    assert.equal((await fixture("/messages")).messages.length, reports.messages.length);
    assert.equal((await call("deliveries", ceo, "POST", { week, phase: "plan" })).status, 409);
    checks++;
    await fixture("/fail", { fail: true });
    const failed = await json("deliveries", ceo, "POST", { week: nextWeek, phase: "plan" });
    assert.equal(failed.status, "uncertain");
    assert.equal(
      (
        await call(`deliveries/${failed.id}/retry`, ceo, "POST", {
          acknowledgePossibleDuplicate: false,
        })
      ).status,
      400,
    );
    await fixture("/fail", { fail: false });
    const retried = await json(`deliveries/${failed.id}/retry`, ceo, "POST", {
      acknowledgePossibleDuplicate: true,
    });
    assert.equal(retried.status, "sent");
    const delivery = await db.opsWeeklyDelivery.findUniqueOrThrow({ where: { id: failed.id } });
    assert.equal(delivery.attempts, 2);
    assert.equal(
      (
        await call(`deliveries/${failed.id}/retry`, ceo, "POST", {
          acknowledgePossibleDuplicate: true,
        })
      ).status,
      409,
    );
    const audits = await db.auditLog.findMany({
      where: { entityId: { in: [...created] }, action: "ops.weekly.submitted" },
    });
    assert.ok(audits.length >= 3);
    assert.ok(audits.every((entry) => entry.userId === person.userId));
    checks++;
    console.log(
      JSON.stringify({
        weeklyIntegrationChecks: checks,
        separatePlanAndReportEmails: true,
        duplicateSchedulesSuppressed: true,
        mockSmtpOnly: true,
      }),
    );
  } finally {
    await fixture("/fail", { fail: false });
    await db.opsWeeklyReport.deleteMany({ where: { id: { in: [...created] } } });
    const deliveries = await db.opsWeeklyDelivery.findMany({ select: { id: true } });
    await db.opsWeeklyDelivery.deleteMany({
      where: {
        id: { in: deliveries.filter((row) => !previousIds.has(row.id)).map((row) => row.id) },
      },
    });
    await db.opsTask.deleteMany({ where: { id: { in: [ownTask, otherTask] } } });
    await db.opsProjectMember.deleteMany({ where: { projectId } });
    await db.opsProjectDepartment.deleteMany({ where: { projectId } });
    await db.opsProject.deleteMany({ where: { id: projectId } });
    if (oldSettings)
      await db.opsWeeklySettings.update({
        where: { id: "workspace" },
        data: { version: oldSettings.version, settings: oldSettings.settings! },
      });
    else await db.opsWeeklySettings.deleteMany({ where: { id: "workspace" } });
    await db.$disconnect();
  }
}
void verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
