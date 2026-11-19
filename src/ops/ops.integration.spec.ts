import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Controller, Get, Module, ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory, Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import cookieParser from "cookie-parser";
import * as bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { bootstrapOps } from "../../prisma/ops-bootstrap";
import { PrismaService } from "../prisma/prisma.service";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ViewAsGuard } from "../auth/guards/view-as.guard";
import { CapabilityGuard } from "../auth/guards/capability.guard";
import { EmailService } from "../notifications/email/email.service";
import { StorageService } from "../storage/storage.service";
import { OpsAuthController } from "./ops-auth.controller";
import { OpsAuthGuard } from "./ops-auth.guard";
import { OpsAuthService } from "./ops-auth.service";
import { OpsController } from "./ops.controller";
import { OpsRepository } from "./ops.repository";
import { OpsService } from "./ops.service";
import type { Workspace } from "./ops.schemas";
import { WeeklyController } from "./weekly/weekly.controller";
import { WeeklyService } from "./weekly/weekly.service";
import { WeeklyClock } from "./weekly/weekly-clock";
import { WeeklyDeliveryService } from "./weekly/weekly-delivery.service";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const databaseUrl = process.env.OPS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const password = "OpsVerification2026!";
jest.setTimeout(30000);

@Controller("legacy-probe")
class LegacyProbe {
  @Get()
  get() {
    return { success: true };
  }
}

suite("Ops HTTP API with isolated MySQL", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let base: string;
  let ceoToken: string;
  let staffToken: string;
  let outsiderToken: string;
  let ceoId: string;
  let staffId: string;
  let outsiderId: string;
  let cookie: string;
  const email = `ceo-${randomUUID()}@ops.test`;
  const staffEmail = `staff-${randomUUID()}@ops.test`;
  const outsiderEmail = `outsider-${randomUUID()}@ops.test`;
  const clientId = randomUUID();
  const projectId = randomUUID();
  const taskId = randomUUID();
  const reportId = randomUUID();
  let docId: string;
  let taskDocId: string;

  async function call(path: string, token?: string, options: RequestInit = {}) {
    return fetch(`${base}/api/v1/${path}`, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  }

  async function snapshot(token = ceoToken): Promise<{ workspace: Workspace; revision: number }> {
    const response = await call("ops/workspace", token);
    expect(response.status).toBe(200);
    return response.json();
  }

  async function change(
    path: string,
    body: unknown,
    token = ceoToken,
    method = "PUT",
    expected = 200,
  ) {
    const { revision } = await snapshot(token);
    const response = await call(`ops/${path}`, token, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "If-Match": String(revision) },
    });
    const result = await response.json();
    expect({ status: response.status, message: result.message }).toEqual({
      status: expected,
      message: expected >= 400 ? expect.anything() : undefined,
    });
    return result;
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.endsWith("_verify"))
      throw new Error("Ops integration tests require a separate local *_verify database.");
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const passwordHash = await bcrypt.hash(password, 4);
    await prisma.user.create({
      data: { email, passwordHash, fullName: "Ops Test CEO", roles: { create: { role: "ceo" } } },
    });
    await bootstrapOps(prisma, email);
    const ceo = await prisma.opsStaff.findFirstOrThrow({ where: { user: { email } } });
    ceoId = ceo.id;
    const staff = await prisma.opsStaff.create({
      data: {
        name: "Ops Test Staff",
        title: "Consultant",
        department: { connect: { id: "hr" } },
        user: { create: { email: staffEmail, passwordHash } },
      },
    });
    const outsider = await prisma.opsStaff.create({
      data: {
        name: "Ops Outside Staff",
        title: "IT specialist",
        department: { connect: { id: "it" } },
        user: { create: { email: outsiderEmail, passwordHash } },
      },
    });
    staffId = staff.id;
    outsiderId = outsider.id;
    const config = new ConfigService({
      JWT_ACCESS_SECRET: "ops-verification-secret",
      NODE_ENV: "test",
      OPS_FRONTEND_URL: "http://127.0.0.1:5176",
    });
    config.set("SMTP_HOST", "");
    config.set("S3_BUCKET", "");
    config.set("OPS_WEEKLY_TEST_NOW", "2026-11-20T16:00:00Z");
    @Module({
      controllers: [OpsAuthController, OpsController, WeeklyController, LegacyProbe],
      providers: [
        Reflector,
        JwtService,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        OpsAuthService,
        OpsAuthGuard,
        OpsRepository,
        OpsService,
        WeeklyService,
        WeeklyClock,
        { provide: WeeklyDeliveryService, useValue: {} },
        JwtStrategy,
        StorageService,
        {
          provide: EmailService,
          useValue: { send: jest.fn<() => Promise<boolean>>().mockResolvedValue(false) },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: ViewAsGuard },
        { provide: APP_GUARD, useClass: CapabilityGuard },
      ],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    for (const [address, set] of [
      [
        email,
        (token: string) => {
          ceoToken = token;
        },
      ],
      [
        staffEmail,
        (token: string) => {
          staffToken = token;
        },
      ],
      [
        outsiderEmail,
        (token: string) => {
          outsiderToken = token;
        },
      ],
    ] as const) {
      const response = await call("ops/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email: address, password, remember: true }),
      });
      expect(response.status).toBe(200);
      set((await response.json()).accessToken);
      if (address === email) cookie = response.headers.get("set-cookie")!.split(";")[0];
    }
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      for (const id of [docId, taskDocId].filter((value): value is string => !!value)) {
        const doc = await prisma.opsDocument.findUnique({ where: { id } });
        if (doc) {
          await prisma.opsDocument.delete({ where: { id } });
          await app.get(StorageService).delete(doc.storageKey);
        }
      }
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it("requires Ops sessions, rejects Ops tokens on legacy routes and refreshes a scoped cookie", async () => {
    expect((await call("ops/workspace")).status).toBe(401);
    expect((await call("legacy-probe", ceoToken)).status).toBe(401);
    const response = await call("ops/auth/refresh", undefined, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).accessToken).toEqual(expect.any(String));
    const json = JSON.stringify(await snapshot());
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("refreshHash");
    expect(json).not.toContain("tokenHash");
    expect(json).not.toContain("AmsolDemo2026");
  });

  it("persists the client, project, team and task flow with relationship validation", async () => {
    await change(
      `records/clients/${clientId}`,
      {
        id: clientId,
        name: "API Test Client",
        contact: "Contact",
        services: ["Recruitment"],
        assignees: [staffId],
      },
      staffToken,
    );
    await change(`records/projects/${projectId}`, {
      id: projectId,
      name: "API Test Project",
      client: clientId,
      lead: staffId,
      depts: ["hr"],
      members: [staffId],
      status: "on-track",
      stage: "In progress",
      progress: 20,
      due: "2026-12-15",
      summary: "Real persistence verification",
    });
    await change(
      `records/tasks/${taskId}`,
      {
        id: taskId,
        title: "API Test Task",
        project: projectId,
        assignee: staffId,
        due: "2026-12-01",
        priority: "High",
        status: "To do",
      },
      staffToken,
    );
    const state = await snapshot(staffToken);
    const task = state.workspace.tasks.find((row) => row.id === taskId)!;
    await change(`records/tasks/${taskId}`, { ...task, status: "Done" }, staffToken);
    await change(
      `tasks/${taskId}/comment`,
      { comment: "Please include the final review notes." },
      staffToken,
      "POST",
      403,
    );
    await change(
      `tasks/${taskId}/comment`,
      { comment: "Please include the final review notes." },
      ceoToken,
      "POST",
    );
    expect(
      (await snapshot(staffToken)).workspace.tasks.find((row) => row.id === taskId)?.ceoComment,
    ).toBe("Please include the final review notes.");
    await change(
      `records/tasks/${taskId}`,
      { ...task, assignee: outsiderId },
      ceoToken,
      "PUT",
      400,
    );
    await change(`records/clients/${clientId}`, undefined, ceoToken, "DELETE", 400);
    expect((await snapshot()).workspace.tasks.find((row) => row.id === taskId)?.status).toBe(
      "Done",
    );
    expect(
      (await snapshot(outsiderToken)).workspace.projects.some((row) => row.id === projectId),
    ).toBe(false);
    await change(
      `records/projects/${projectId}`,
      state.workspace.projects.find((row) => row.id === projectId),
      outsiderToken,
      "PUT",
      403,
    );
  });

  it("locks reviewed reports and retains reviewer identity and feedback", async () => {
    const report = {
      id: reportId,
      title: "API Project Update",
      type: "Project update",
      project: projectId,
      dept: "hr",
      author: staffId,
      date: "2026-11-11",
      progress: "Work completed",
      blockers: "Awaiting signoff",
      next: "Deliver",
      reviewed: false,
    };
    await change(`records/reports/${reportId}`, report, staffToken);
    await change(`reports/${reportId}/review`, { comment: "Approved" }, staffToken, "POST", 403);
    await change(`reports/${reportId}/review`, { comment: "Approved" }, ceoToken, "POST");
    await change(
      `records/reports/${reportId}`,
      { ...report, progress: "Rewritten" },
      staffToken,
      "PUT",
      403,
    );
    await change(
      `records/reports/${reportId}`,
      { ...report, progress: "Rewritten" },
      ceoToken,
      "PUT",
      403,
    );
    const history = await call(`ops/reports/${reportId}/reviews`, staffToken);
    expect(await history.json()).toEqual([
      expect.objectContaining({ reviewerId: ceoId, comment: "Approved" }),
    ]);
    expect((await call(`ops/reports/${reportId}/reviews`, outsiderToken)).status).toBe(404);
  });

  it("rejects stale writes and concurrent saves without partial data", async () => {
    const { workspace, revision } = await snapshot();
    const client = workspace.clients.find((row) => row.id === clientId)!;
    const results = await Promise.all(
      ["Concurrent A", "Concurrent B"].map((name) =>
        call(`ops/records/clients/${clientId}`, ceoToken, {
          method: "PUT",
          headers: { "If-Match": String(revision) },
          body: JSON.stringify({ ...client, name }),
        }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it("filters business figures on the server and accepts multiple dated entries per month", async () => {
    const businessId = randomUUID();
    const financeId = randomUUID();
    await change(`records/businesses/${businessId}`, {
      id: businessId,
      name: "API Restricted Business",
      sector: "Services",
    });
    const row = {
      id: financeId,
      business: businessId,
      month: "2026-11",
      date: "2026-11-12",
      description: "Monthly payroll",
      revenue: 10.25,
      expenses: 0,
    };
    await change(`records/businessFinance/${financeId}`, row);
    const duplicateId = randomUUID();
    await change(`records/businessFinance/${duplicateId}`, {
      ...row,
      id: duplicateId,
      date: "2026-11-20",
      description: "Consulting income",
    });
    expect(
      (await snapshot(staffToken)).workspace.businessFinance.some(
        (entry) => entry.business === businessId,
      ),
    ).toBe(false);
    await change(`business-permissions/${staffId}`, { home: null, grants: [businessId] });
    expect(
      (await snapshot(staffToken)).workspace.businessFinance.some(
        (entry) => entry.business === businessId,
      ),
    ).toBe(false);
    await change(`business-permissions/${staffId}`, {
      home: null,
      grants: [businessId],
      permissions: [{ business: businessId, finance: "view" }],
    });
    const staffFinance = (await snapshot(staffToken)).workspace.businessFinance.filter(
      (entry) => entry.business === businessId,
    );
    expect(staffFinance).toHaveLength(2);
    expect(staffFinance.find((entry) => entry.id === financeId)?.revenue).toBe(10.25);
    await change(
      `records/businessFinance/${financeId}`,
      { ...row, revenue: 50 },
      staffToken,
      "PUT",
      403,
    );
  });

  it("stores original files and checks download permissions after grants change", async () => {
    docId = randomUUID();
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        id: docId,
        name: "verification.txt",
        folder: "Verification",
        access: "restricted",
        owner: ceoId,
        updated: "2026-11-11",
        allowed: [staffId],
        mime: "text/plain",
      }),
    );
    form.append(
      "file",
      new Blob(["Original Ops document content"], { type: "text/plain" }),
      "verification.txt",
    );
    const { revision } = await snapshot();
    const uploaded = await call("ops/documents", ceoToken, {
      method: "POST",
      headers: { "If-Match": String(revision) },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const allowed = await call(`ops/documents/${docId}/content`, staffToken);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("Original Ops document content");
    expect((await call(`ops/documents/${docId}/content`, outsiderToken)).status).toBe(404);
    const doc = (await snapshot()).workspace.documents.find((row) => row.id === docId)!;
    await change(`records/documents/${docId}`, { ...doc, allowed: [outsiderId] });
    expect((await call(`ops/documents/${docId}/content`, staffToken)).status).toBe(404);
  });

  it("attaches task files to their project and restricts downloads to project members", async () => {
    taskDocId = randomUUID();
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        id: taskDocId,
        name: "task-evidence.txt",
        folder: "Task attachments",
        access: "project",
        owner: staffId,
        updated: "2026-11-15",
        project: projectId,
        task: taskId,
        mime: "text/plain",
      }),
    );
    form.append("file", new Blob(["Task attachment"], { type: "text/plain" }), "task-evidence.txt");
    const { revision } = await snapshot(staffToken);
    const uploaded = await call("ops/documents", staffToken, {
      method: "POST",
      headers: { "If-Match": String(revision) },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    expect(
      (await snapshot(staffToken)).workspace.documents.find((document) => document.id === taskDocId)
        ?.task,
    ).toBe(taskId);
    expect((await call(`ops/documents/${taskDocId}/content`, staffToken)).status).toBe(200);
    expect((await call(`ops/documents/${taskDocId}/content`, outsiderToken)).status).toBe(404);
  });

  it("issues single-use invitations, accepts them, and invalidates deactivated sessions", async () => {
    const invitedEmail = `invited-${randomUUID()}@ops.test`;
    const invitation = await change(
      "invitations",
      {
        name: "Invited Staff",
        title: "Consultant",
        dept: "hr",
        email: invitedEmail,
        role: "staff",
      },
      ceoToken,
      "POST",
      201,
    );
    expect(invitation.emailSent).toBe(false);
    const token = new URL(invitation.invitationUrl).searchParams.get("token")!;
    const response = await call("ops/auth/accept-invitation", undefined, {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
    expect(response.status).toBe(200);
    const session = await response.json();
    const reused = await call("ops/auth/accept-invitation", undefined, {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
    expect(reused.status).toBe(401);
    const profile = await (await call("ops/auth/me", session.accessToken)).json();
    await change(`accounts/${profile.id}`, { role: "staff", active: false }, ceoToken, "PATCH");
    expect((await call("ops/workspace", session.accessToken)).status).toBe(401);
  });

  it("persists tenders, service requests, templates, department registers and settings", async () => {
    const tenderId = randomUUID();
    const requestId = randomUUID();
    const templateId = randomUUID();
    const registerId = randomUUID();
    const tender = {
      id: tenderId,
      title: `Tender ${tenderId}`,
      issuer: "Verification Client",
      value: 0,
      due: "2026-12-15",
      stage: "Identified",
      members: [staffId],
    };
    await change(`records/tenders/${tenderId}`, tender);
    await change(`records/tenders/${tenderId}`, { ...tender, stage: "Submitted" }, staffToken);
    expect(
      (await snapshot(outsiderToken)).workspace.tenders.some((row) => row.id === tenderId),
    ).toBe(false);
    await change(
      `records/clientRequests/${requestId}`,
      {
        id: requestId,
        title: "Service request",
        client: clientId,
        source: "operations",
        received: "2026-11-11",
        handler: staffId,
        status: "Received",
      },
      staffToken,
    );
    expect(
      (await snapshot(staffToken)).workspace.clientRequests.some((row) => row.id === requestId),
    ).toBe(true);
    expect(
      (await snapshot(outsiderToken)).workspace.clientRequests.some((row) => row.id === requestId),
    ).toBe(false);
    await change(`records/templates/${templateId}`, {
      id: templateId,
      name: "API template",
      progress: "Progress",
      blockers: "Support",
      next: "Next actions",
    });
    const state = await snapshot();
    const department = state.workspace.departments.find((row) => row.id === "hr")!;
    await change(
      `records/moduleRecords/${registerId}`,
      {
        id: registerId,
        dept: "hr",
        module: department.modules[0],
        title: "API register entry",
        owner: staffId,
        date: "2026-11-11",
        status: "Planned",
        notes: "Tracked by the backend",
        amount: 0,
      },
      staffToken,
    );
    await change("records/departments/hr", { ...department, modules: [] }, ceoToken, "PUT", 400);
    await change("settings", { ...state.workspace.settings, reminderDays: 10 });
    await change("settings", state.workspace.settings, staffToken, "PUT", 403);
    expect(
      (await snapshot()).workspace.moduleRecords.find((row) => row.id === registerId)?.amount,
    ).toBe(0);
    const listing = await (
      await call(`ops/records/tenders?page=1&limit=1&search=${tenderId}`, staffToken)
    ).json();
    expect(listing.total).toBe(1);
    expect(listing.items[0].stage).toBe("Submitted");
    const hidden = await (
      await call(`ops/records/tenders?search=${tenderId}`, outsiderToken)
    ).json();
    expect(hidden.total).toBe(0);
  });

  it("corrects a staff email, revokes old sessions and links, and resends to the corrected address", async () => {
    const wrongEmail = `incorrect-${randomUUID()}@ops.test`;
    const correctEmail = `corrected-${randomUUID()}@ops.test`;
    const user = await prisma.user.create({
      data: { email: wrongEmail, passwordHash: await bcrypt.hash(password, 4) },
    });
    const staff = await prisma.opsStaff.create({
      data: { userId: user.id, name: "Email correction", title: "Consultant", dept: "hr" },
    });
    const initial = await change(
      `accounts/${staff.id}/invitation`,
      undefined,
      ceoToken,
      "POST",
      201,
    );
    const oldLink = new URL(initial.invitationUrl).searchParams.get("token")!;
    const login = await call("ops/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email: wrongEmail, password }),
    });
    const oldSession = (await login.json()).accessToken;
    const reset = await prisma.opsPasswordReset.create({
      data: {
        staffId: staff.id,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "a"),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const profile = {
      name: staff.name,
      title: "Senior Consultant",
      dept: "hr",
      email: correctEmail.toUpperCase(),
    };
    await change(`staff/${staff.id}`, profile, staffToken, "PATCH", 403);
    await change(`staff/${ceoId}`, profile, ceoToken, "PATCH", 403);
    await change(`staff/${staff.id}`, { ...profile, email: staffEmail }, ceoToken, "PATCH", 409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
      wrongEmail,
    );
    await change(`staff/${staff.id}`, profile, ceoToken, "PATCH");
    expect((await snapshot()).workspace.accounts.find((row) => row.id === staff.id)?.email).toBe(
      correctEmail,
    );
    expect((await call("ops/workspace", oldSession)).status).toBe(401);
    expect((await call(`ops/auth/invitation?token=${oldLink}`)).status).toBe(401);
    expect(
      (await prisma.opsPasswordReset.findUniqueOrThrow({ where: { id: reset.id } })).usedAt,
    ).not.toBeNull();
    expect(
      (
        await call("ops/auth/login", undefined, {
          method: "POST",
          body: JSON.stringify({ email: wrongEmail, password }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("ops/auth/login", undefined, {
          method: "POST",
          body: JSON.stringify({ email: correctEmail, password }),
        })
      ).status,
    ).toBe(200);
    const renewed = await change(
      `accounts/${staff.id}/invitation`,
      undefined,
      ceoToken,
      "POST",
      201,
    );
    const token = new URL(renewed.invitationUrl).searchParams.get("token")!;
    expect(await (await call(`ops/auth/invitation?token=${token}`)).json()).toEqual({
      email: correctEmail,
    });
  });

  it("deletes Ops account access while retaining linked staff history and the shared identity", async () => {
    const address = `remove-access-${randomUUID()}@ops.test`;
    const user = await prisma.user.create({
      data: { email: address, passwordHash: await bcrypt.hash(password, 4) },
    });
    const staff = await prisma.opsStaff.create({
      data: { userId: user.id, name: "Retained Staff", title: "Consultant", dept: "hr" },
    });
    const task = await prisma.opsTask.create({
      data: {
        title: "Retained work",
        assignee: staff.id,
        due: "2026-12-01",
        priority: "High",
        status: "To do",
      },
    });
    await prisma.opsModuleGrant.create({
      data: { staffId: staff.id, module: "inventory", access: "view" },
    });
    const invitation = await change(
      `accounts/${staff.id}/invitation`,
      undefined,
      ceoToken,
      "POST",
      201,
    );
    const token = new URL(invitation.invitationUrl).searchParams.get("token")!;
    const login = await call("ops/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email: address, password }),
    });
    const session = (await login.json()).accessToken;
    const failed = await change(`records/people/${staff.id}`, undefined, ceoToken, "DELETE", 400);
    expect(failed.message).toContain("linked work or reporting history");
    await change(`accounts/${staff.id}`, undefined, staffToken, "DELETE", 403);
    await change(`accounts/${ceoId}`, undefined, ceoToken, "DELETE", 403);
    await change(`accounts/${staff.id}`, undefined, ceoToken, "DELETE");
    const retained = await prisma.opsStaff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(retained.userId).toBeNull();
    expect(retained.active).toBe(false);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.opsTask.findUnique({ where: { id: task.id } })).not.toBeNull();
    expect(await prisma.opsModuleGrant.count({ where: { staffId: staff.id } })).toBe(0);
    expect((await call("ops/workspace", session)).status).toBe(401);
    expect((await call(`ops/auth/invitation?token=${token}`)).status).toBe(401);
    expect((await snapshot()).workspace.accounts.some((row) => row.id === staff.id)).toBe(false);
  });

  it("deletes an unused staff entry with its account and business grants in one transaction", async () => {
    const address = `unused-staff-${randomUUID()}@ops.test`;
    await change(
      "invitations",
      { name: "Unused Staff", title: "Consultant", dept: "hr", email: address, role: "staff" },
      ceoToken,
      "POST",
      201,
    );
    const staff = await prisma.opsStaff.findFirstOrThrow({ where: { user: { email: address } } });
    await prisma.opsBusinessGrant.create({
      data: { personId: staff.id, businessId: "b0", kind: "grant" },
    });
    await change(`records/people/${staff.id}`, undefined, ceoToken, "DELETE");
    expect(await prisma.opsStaff.findUnique({ where: { id: staff.id } })).toBeNull();
    expect(await prisma.opsInvitation.count({ where: { staffId: staff.id } })).toBe(0);
    expect(await prisma.opsBusinessGrant.count({ where: { personId: staff.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { email: address } })).not.toBeNull();
  });

  it("lists only personal weekly submissions and appends tasks with versioned history and task-state preservation", async () => {
    const user = await prisma.user.create({
      data: {
        email: `weekly-ui-${randomUUID()}@ops.test`,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    const staff = await prisma.opsStaff.create({
      data: { userId: user.id, name: "Weekly UI", title: "Consultant", dept: "hr" },
    });
    const login = await call("ops/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email: user.email, password }),
    });
    const token = (await login.json()).accessToken;
    const settings = await (await call("ops/weekly/settings", ceoToken)).json();
    await call("ops/weekly/settings", ceoToken, {
      method: "PUT",
      body: JSON.stringify({
        version: settings.version,
        settings: { ...settings.settings, startWeek: "2026-11-16" },
      }),
    });
    const weeklyCall = (path: string, body: unknown, who = token) =>
      call(`ops/weekly/${path}`, who, { method: "POST", body: JSON.stringify(body) });
    const first = {
      id: randomUUID(),
      title: "Original task",
      detail: "Expected result",
      status: "planned",
    };
    const submission = {
      summary: "Complete the weekly work",
      items: [first],
      blockers: "",
      nextWeek: "",
      noWorkReason: "",
    };
    const saved = await call("ops/weekly/reports/2026-11-16/plan", token, {
      method: "PUT",
      body: JSON.stringify({ version: 0, submit: true, submission }),
    });
    expect(saved.status).toBe(200);
    const plan = await saved.json();
    const original = await prisma.opsWeeklyReport.findUniqueOrThrow({ where: { id: plan.id } });
    await prisma.opsTask.update({ where: { id: first.id }, data: { status: "Done" } });
    expect(
      (
        await weeklyCall(
          `submissions/${plan.id}/review`,
          { version: 1, comment: "Reviewed" },
          ceoToken,
        )
      ).status,
    ).toBe(200);
    const added = {
      id: randomUUID(),
      title: "Urgent additional task",
      detail: "New result",
      status: "planned",
      priority: "Urgent",
      source: "contingency",
    };
    expect(
      (await weeklyCall(`submissions/${plan.id}/tasks`, { version: 1, items: [added] })).status,
    ).toBe(409);
    expect(
      (await weeklyCall(`submissions/${plan.id}/tasks`, { version: 2, items: [added] }, staffToken))
        .status,
    ).toBe(404);
    expect(
      (await weeklyCall(`submissions/${plan.id}/tasks`, { version: 2, items: [added] }, ceoToken))
        .status,
    ).toBe(403);
    expect(
      (
        await weeklyCall(`submissions/${plan.id}/tasks`, {
          version: 2,
          items: [{ ...added, taskId }],
        })
      ).status,
    ).toBe(403);
    const results = await Promise.all([
      weeklyCall(`submissions/${plan.id}/tasks`, { version: 2, items: [added] }),
      weeklyCall(`submissions/${plan.id}/tasks`, {
        version: 2,
        items: [{ ...added, id: randomUUID() }],
      }),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    const updated = await prisma.opsWeeklyReport.findUniqueOrThrow({ where: { id: plan.id } });
    const content = updated.submission as unknown as typeof submission;
    expect(content.items).toHaveLength(2);
    expect(content.items[0]).toEqual(first);
    expect(updated.submittedAt).toEqual(original.submittedAt);
    expect(updated.reviewedAt).toBeNull();
    expect((await prisma.opsTask.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      "Done",
    );
    expect(await prisma.opsTask.findUnique({ where: { id: content.items[1].id } })).not.toBeNull();
    const history = await (await call(`ops/weekly/submissions/${plan.id}/history`, token)).json();
    expect(
      history.find((row: { action: string }) => row.action === "ops.weekly.tasks_added").newValue
        .previousSubmission.items,
    ).toHaveLength(1);
    const own = await (await call("ops/weekly/submissions?phase=plan", token)).json();
    expect(own.items.map((row: { staffId: string }) => row.staffId)).toEqual([staff.id]);
    expect(
      (await call(`ops/weekly/submissions?phase=plan&staffId=${staff.id}`, staffToken)).status,
    ).toBe(400);
    const hidden = await (await call("ops/weekly/submissions?phase=plan", outsiderToken)).json();
    expect(hidden.items.some((row: { id: string }) => row.id === plan.id)).toBe(false);
    expect((await call(`ops/weekly/submissions/${plan.id}/history`, outsiderToken)).status).toBe(
      404,
    );
    const report = await call("ops/weekly/reports/2026-11-16/report", token, {
      method: "PUT",
      body: JSON.stringify({
        version: 0,
        submit: true,
        submission: {
          ...content,
          items: content.items.map((item) => ({
            ...item,
            taskId: item.id,
            id: randomUUID(),
            status: "completed",
          })),
        },
      }),
    });
    expect(report.status).toBe(200);
    expect(
      (
        await weeklyCall(`submissions/${plan.id}/tasks`, {
          version: updated.version,
          items: [{ ...added, id: randomUUID() }],
        })
      ).status,
    ).toBe(409);
  });

  it("changes passwords, revokes other Ops sessions and logs out the current session", async () => {
    const other = await (
      await call("ops/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email: staffEmail, password }),
      })
    ).json();
    const response = await call("ops/auth/change-password", staffToken, {
      method: "POST",
      body: JSON.stringify({ currentPassword: password, newPassword: "ChangedOpsPassword2026!" }),
    });
    expect(response.status).toBe(200);
    expect((await call("ops/workspace", other.accessToken)).status).toBe(401);
    expect((await call("ops/auth/logout", staffToken, { method: "POST" })).status).toBe(200);
    expect((await call("ops/workspace", staffToken)).status).toBe(401);
  });
});
