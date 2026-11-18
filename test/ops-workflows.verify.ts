import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

async function verify() {
  const url = new URL(process.env.OPS_TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_verify"))
    throw new Error("Use a separate local *_verify database.");
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const base = "http://127.0.0.1:4001/api/v1/ops";
  const suffix = randomUUID();
  async function request(
    path: string,
    token = "",
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
  }
  async function json(
    path: string,
    token = "",
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await request(path, token, method, body, headers);
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify({ path, status: response.status, result }));
    return result;
  }
  const login = async (email: string, password = "OpsBrowser2026!") =>
    (await json("/auth/login", "", "POST", { email, password })).accessToken as string;
  const ceo = await login("ceo@ops-verify.local");
  let staff = await login("staff@ops-verify.local");
  const outsider = await login("it@ops-verify.local");
  const actor = await json("/auth/me", staff);
  const other = await json("/auth/me", outsider);
  async function mutate(path: string, token: string, method: string, body?: unknown) {
    const snapshot = await json("/workspace", token);
    return json(path, token, method, body, { "If-Match": String(snapshot.revision) });
  }
  async function rejected(
    path: string,
    token: string,
    method: string,
    body: unknown,
    expected: number,
  ) {
    const snapshot = await json("/workspace", token);
    const response = await request(path, token, method, body, {
      "If-Match": String(snapshot.revision),
    });
    assert.equal(response.status, expected, await response.text());
  }
  async function control(path: string, body: unknown = {}) {
    const response = await fetch(`http://127.0.0.1:2527${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok);
    return response.json();
  }
  const originalUser = await db.user.findFirstOrThrow({
    where: { email: "staff@ops-verify.local" },
  });
  try {
    await control("/reset");
    await control("/clock", { now: "2026-11-20T16:00:00Z" });
    const asset = await json("/inventory", ceo, "POST", {
      assetTag: suffix,
      deviceName: `Workflow laptop ${suffix}`,
      category: "laptop",
      status: "in_use",
      condition: "good",
    });
    await mutate(`/accounts/${actor.id}/modules`, ceo, "PUT", {
      module: "inventory",
      access: "none",
    });
    assert.equal((await request("/inventory", staff)).status, 403);
    await mutate(`/accounts/${actor.id}/modules`, ceo, "PUT", {
      module: "inventory",
      access: "view",
    });
    const inventory = await json(
      `/inventory?q=${encodeURIComponent(suffix)}&category=laptop&status=in_use`,
      staff,
    );
    assert.deepEqual(
      inventory.data.map((row: { id: string }) => row.id),
      [asset.id],
    );
    assert.equal(
      (await request(`/inventory/${asset.id}`, staff, "PATCH", { condition: "faulty" })).status,
      403,
    );
    await mutate(`/accounts/${actor.id}/modules`, ceo, "PUT", {
      module: "inventory",
      access: "manage",
    });
    await json(`/inventory/${asset.id}`, staff, "PATCH", { condition: "working" });
    assert.equal((await json(`/inventory/${asset.id}`, ceo)).condition, "working");
    assert.equal((await request(`/inventory/${asset.id}`, outsider)).status, 403);
    const legacyDept = await db.department.upsert({
      where: { code: "tender" },
      create: { code: "tender", name: "Tender" },
      update: {},
    });
    const ownTender = await db.tender.create({
      data: {
        title: `Assigned bid ${suffix}`,
        departmentId: legacyDept.id,
        accountManagerId: originalUser.id,
      },
    });
    const otherUser = await db.opsStaff.findUniqueOrThrow({ where: { id: other.id } });
    const otherTender = await db.tender.create({
      data: {
        title: `Other bid ${suffix}`,
        departmentId: legacyDept.id,
        accountManagerId: otherUser.userId,
      },
    });
    await mutate(`/accounts/${actor.id}/modules`, ceo, "PUT", { module: "tender", access: "view" });
    const tenderList = await json("/tenders", staff);
    assert.ok(tenderList.some((row: { id: string }) => row.id === ownTender.id));
    assert.ok(!tenderList.some((row: { id: string }) => row.id === otherTender.id));
    assert.equal((await request(`/tenders/${otherTender.id}`, staff)).status, 404);
    assert.equal(
      (await request(`/tenders/${ownTender.id}`, staff, "PATCH", { notes: "Denied" })).status,
      403,
    );
    assert.equal((await json(`/tenders/${ownTender.id}`, ceo)).tender.id, ownTender.id);

    const businessA = randomUUID(),
      businessB = randomUUID();
    for (const [id, name] of [
      [businessA, "Managed business"],
      [businessB, "Finance business"],
    ])
      await mutate(`/records/businesses/${id}`, ceo, "PUT", {
        id,
        name: `${name} ${suffix}`,
        sector: "Services",
      });
    for (const business of [businessA, businessB]) {
      const id = randomUUID();
      await mutate(`/records/businessFinance/${id}`, ceo, "PUT", {
        id,
        business,
        month: "2026-11",
        date: "2026-11-20",
        description: "Verification entry",
        revenue: 100,
        expenses: 20,
      });
    }
    await mutate(`/business-permissions/${actor.id}`, ceo, "PUT", {
      home: null,
      grants: [businessA, businessB],
      permissions: [
        { business: businessA, manage: true },
        { business: businessB, finance: "view" },
      ],
    });
    const scoped = (await json("/workspace", staff)).workspace;
    assert.ok(scoped.businesses.some((row: { id: string }) => row.id === businessA));
    assert.ok(
      !scoped.businessFinance.some((row: { business: string }) => row.business === businessA),
    );
    assert.ok(
      scoped.businessFinance.some((row: { business: string }) => row.business === businessB),
    );
    const deniedFinance = randomUUID();
    await rejected(
      `/records/businessFinance/${deniedFinance}`,
      staff,
      "PUT",
      {
        id: deniedFinance,
        business: businessA,
        month: "2026-11",
        date: "2026-11-20",
        description: "Denied",
        revenue: 1,
        expenses: 0,
      },
      403,
    );

    const clientId = randomUUID();
    await mutate(`/records/clients/${clientId}`, staff, "PUT", {
      id: clientId,
      name: `Assigned client ${suffix}`,
      contact: "Contact",
      services: ["HR"],
      assignees: [actor.id],
    });
    assert.ok(
      !(await json("/workspace", outsider)).workspace.clients.some(
        (row: { id: string }) => row.id === clientId,
      ),
    );
    const savedClient = (await json("/workspace", ceo)).workspace.clients.find(
      (row: { id: string }) => row.id === clientId,
    );
    await mutate(`/records/clients/${clientId}`, ceo, "PUT", {
      ...savedClient,
      assignedDept: "it",
    });
    assert.ok(
      (await json("/workspace", outsider)).workspace.clients.some(
        (row: { id: string }) => row.id === clientId,
      ),
    );

    if (
      !(await json("/leave", staff)).some(
        (row: { start: string; end: string }) =>
          row.start === "2026-11-17" && row.end === "2026-11-18",
      )
    )
      await mutate("/leave", staff, "POST", {
        start: "2026-11-17",
        end: "2026-11-18",
        note: "Recorded leave",
      });
    await rejected("/leave", staff, "POST", { start: "2026-11-18", end: "2026-11-19" }, 409);
    assert.equal((await request(`/leave?staff=${other.id}`, staff)).status, 404);
    const settings = await json("/weekly/settings", ceo);
    await json("/weekly/settings", ceo, "PUT", {
      version: settings.version,
      settings: { ...settings.settings, startWeek: "2026-11-16" },
    });
    const itemId = randomUUID();
    const submission = {
      summary: "Planned weekly results",
      items: [
        {
          id: itemId,
          title: "Planned task",
          detail: "Prepare results",
          status: "planned",
          subtasks: [{ id: randomUUID(), title: "Review data", done: false }],
        },
      ],
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
    };
    await json("/weekly/reports/2026-11-16/plan", staff, "PUT", {
      version: 0,
      submit: true,
      submission,
    });
    const task = (await json("/workspace", staff)).workspace.tasks.find(
      (row: { id: string }) => row.id === itemId,
    );
    assert.ok(task);
    assert.equal(task.project, "");
    await mutate(`/records/tasks/${itemId}`, staff, "PUT", {
      ...task,
      subtasks: task.subtasks.map((row: object) => ({ ...row, done: true })),
    });
    const urgentId = randomUUID();
    await mutate(`/records/tasks/${urgentId}`, staff, "PUT", {
      id: urgentId,
      title: "Urgent contingency",
      project: "",
      assignee: actor.id,
      due: "2026-11-20",
      weekStart: "2026-11-16",
      priority: "Urgent",
      source: "contingency",
      status: "In progress",
    });
    assert.ok(
      !(await json("/workspace", outsider)).workspace.tasks.some(
        (row: { id: string }) => row.id === urgentId,
      ),
    );
    const report = {
      ...submission,
      summary: "Weekly outcomes",
      items: [
        { ...submission.items[0], status: "completed" },
        {
          id: randomUUID(),
          taskId: urgentId,
          title: "Urgent contingency",
          detail: "Resolved immediately",
          status: "completed",
          priority: "Urgent",
          source: "contingency",
        },
      ],
    };
    const draft = await json("/weekly/reports/2026-11-16/report", staff, "PUT", {
      version: 0,
      submit: false,
      submission: report,
    });
    await mutate("/submission-schedules", staff, "PUT", {
      kind: "report",
      target: "2026-11-16",
      runAt: "2026-11-20T18:00:00Z",
    });
    await json("/weekly/reports/2026-11-16/report", staff, "PUT", {
      version: draft.version,
      submit: false,
      submission: { ...report, summary: "Updated before scheduled submission" },
    });
    await control("/clock", { now: "2026-11-20T17:00:00Z" });
    const reminder = await control("/workflow-tick");
    assert.ok(
      reminder.messages.some((message: { recipients: string[] }) =>
        message.recipients.some((recipient) => recipient.includes("staff@ops-verify.local")),
      ),
    );
    assert.ok(!(await json(`/weekly/reports/2026-11-16/${actor.id}`, staff)).report.submittedAt);
    await control("/clock", { now: "2026-11-20T18:00:00Z" });
    await control("/workflow-tick");
    const submitted = (await json(`/weekly/reports/2026-11-16/${actor.id}`, staff)).report;
    assert.ok(submitted.submittedAt);
    assert.equal(submitted.submission.summary, "Updated before scheduled submission");
    assert.equal(submitted.submission.leave.length, 1);
    const messages = await control("/workflow-tick");
    assert.equal(messages.messages.length, reminder.messages.length);

    const monthlyId = randomUUID();
    let monthly = {
      id: monthlyId,
      title: `Monthly results ${suffix}`,
      type: "Monthly",
      dept: "hr",
      author: actor.id,
      date: "2026-11-20",
      month: "2026-11",
      reviewed: false,
      status: "draft",
      progress: "Completed planned and contingency work",
      taskIds: [itemId, urgentId],
      attachments: [] as string[],
    };
    await mutate(`/records/reports/${monthlyId}`, staff, "PUT", monthly);
    assert.ok(
      !(await json("/workspace", ceo)).workspace.reports.some(
        (row: { id: string }) => row.id === monthlyId,
      ),
    );
    const monthlyFile = new FormData();
    const monthlyDoc = randomUUID();
    monthlyFile.append(
      "metadata",
      JSON.stringify({
        id: monthlyDoc,
        name: "monthly.txt",
        folder: "Monthly reports",
        access: "restricted",
        owner: actor.id,
        allowed: [actor.id],
        report: monthlyId,
        updated: "2026-11-20",
      }),
    );
    monthlyFile.append("file", new Blob(["Monthly supporting evidence"]), "monthly.txt");
    await mutate("/documents", staff, "POST", monthlyFile);
    monthly = { ...monthly, attachments: [monthlyDoc] };
    await mutate(`/records/reports/${monthlyId}`, staff, "PUT", monthly);
    await mutate("/submission-schedules", staff, "PUT", {
      kind: "monthly",
      target: monthlyId,
      runAt: "2026-11-20T18:05:00Z",
    });
    await json("/auth/logout", staff, "POST");
    await control("/clock", { now: "2026-11-20T18:05:00Z" });
    await control("/workflow-tick");
    const monthlyResult = (await json("/workspace", ceo)).workspace.reports.find(
      (row: { id: string }) => row.id === monthlyId,
    );
    assert.equal(monthlyResult.status, "submitted");
    assert.equal(monthlyResult.taskSnapshots.length, 2);
    assert.equal(monthlyResult.leaveSnapshot.length, 1);
    assert.equal(
      await (await request(`/documents/${monthlyDoc}/content`, ceo)).text(),
      "Monthly supporting evidence",
    );
    staff = await login("staff@ops-verify.local");

    const documentId = randomUUID();
    const body = new FormData();
    body.append(
      "metadata",
      JSON.stringify({
        id: documentId,
        name: "shared.txt",
        folder: "Company",
        access: "restricted",
        owner: actor.id,
        allowed: [other.id],
        updated: "2026-11-20",
      }),
    );
    body.append("file", new Blob(["Version one"]), "shared.txt");
    await mutate("/documents", staff, "POST", body);
    assert.equal(
      await (await request(`/documents/${documentId}/content`, outsider)).text(),
      "Version one",
    );
    const version = new FormData();
    version.append("file", new Blob(["Version two"]), "updated.txt");
    await mutate(`/documents/${documentId}/versions`, staff, "POST", version);
    assert.equal((await json(`/documents/${documentId}/versions`, outsider)).length, 2);
    assert.equal(
      await (await request(`/documents/${documentId}/versions/1/content`, outsider)).text(),
      "Version one",
    );
    assert.equal(
      await (await request(`/documents/${documentId}/content`, outsider)).text(),
      "Version two",
    );
    const document = (await json("/workspace", staff)).workspace.documents.find(
      (row: { id: string }) => row.id === documentId,
    );
    await mutate(`/records/documents/${documentId}`, staff, "PUT", {
      ...document,
      allowed: [actor.id],
    });
    assert.equal(
      (await request(`/documents/${documentId}/versions/1/content`, outsider)).status,
      404,
    );

    await json("/auth/forgot-password", "", "POST", { email: "staff@ops-verify.local" });
    const inbox = await (await fetch("http://127.0.0.1:2527")).json();
    const raw = inbox.messages
      .map((message: { raw: string }) => message.raw)
      .join("\n")
      .replace(/=\r?\n/g, "")
      .replace(/=3D/g, "=");
    const token = raw.match(/reset=([a-f0-9]{64})/)?.[1];
    assert.ok(token);
    await json("/auth/reset-password", "", "POST", {
      token,
      password: "OpsResetVerification2026!",
    });
    assert.equal((await request("/workspace", staff)).status, 401);
    assert.equal(
      (
        await request("/auth/reset-password", "", "POST", {
          token,
          password: "AnotherVerification2026!",
        })
      ).status,
      400,
    );
    assert.ok(await login("staff@ops-verify.local", "OpsResetVerification2026!"));
    process.stdout.write(
      "Ops workflow API verification passed: inventory grants and filters, business finance isolation, client assignments, weekly tasks, leave, scheduled submissions and reminders, monthly attachments, shared document versions, and password recovery.\n",
    );
  } finally {
    await db.user.update({
      where: { id: originalUser.id },
      data: { passwordHash: originalUser.passwordHash },
    });
    await db.$disconnect();
  }
}
verify().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : "Verification failed"}\n`);
  process.exitCode = 1;
});
