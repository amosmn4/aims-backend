import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Module, ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SanitizeInputPipe } from "../../common/sanitize";
import { OpsAuthService } from "../ops-auth.service";
import { OpsAuthGuard } from "../ops-auth.guard";
import { parse, type Viewer } from "../ops.schemas";
import { WeeklyController } from "./weekly.controller";
import { WeeklyDeliveryService } from "./weekly-delivery.service";
import { WeeklyService } from "./weekly.service";
import { weeklySaveSchema } from "./weekly.schemas";

jest.mock("sanitize-html", () => {
  const { createRequire } = process.getBuiltinModule("module");
  return createRequire(__filename)("sanitize-html");
});

const viewer = { id: "staff", role: "staff", name: "Staff" } as Viewer;
const save = jest
  .fn<(viewer: Viewer, week: string, phase: string, body: unknown) => Promise<object>>()
  .mockImplementation(async (_viewer, _week, _phase, body) => {
    const value = parse(weeklySaveSchema, body);
    return { success: true, lateReason: value.lateReason ?? null };
  });
const submission = {
  summary: "Weekly report",
  items: [],
  blockers: "",
  nextWeek: "",
  noWorkReason: "On approved leave this week.",
};

describe("Weekly submission HTTP validation", () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    @Module({
      controllers: [WeeklyController],
      providers: [
        OpsAuthGuard,
        { provide: OpsAuthService, useValue: { authenticate: async () => viewer } },
        { provide: WeeklyService, useValue: { save } },
        { provide: WeeklyDeliveryService, useValue: {} },
      ],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new SanitizeInputPipe(),
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    save.mockClear();
  });

  async function send(phase: string, body: object) {
    return fetch(`${base}/api/v1/ops/weekly/reports/2026-11-23/${phase}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-session" },
      body: JSON.stringify(body),
    });
  }

  it.each(["plan", "report"])("passes a late %s reason through the controller", async (phase) => {
    const lateReason = "Client confirmation arrived after the deadline.";
    const response = await send(phase, { version: 0, submit: true, lateReason, submission });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, lateReason });
    expect(save).toHaveBeenCalledWith(
      viewer,
      "2026-11-23",
      phase,
      expect.objectContaining({ lateReason }),
    );
  });

  it.each(["plan", "report"])("accepts a %s update without a late reason", async (phase) => {
    const response = await send(phase, { version: 1, submit: true, submission });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, lateReason: null });
  });

  it("accepts drafts without a late reason", async () => {
    const response = await send("report", { version: 0, submit: false, submission });
    expect(response.status).toBe(200);
  });

  it.each(["no", "x".repeat(1001), 123])(
    "rejects an invalid late reason %#",
    async (lateReason) => {
      const response = await send("report", { version: 0, submit: true, lateReason, submission });
      expect(response.status).toBe(400);
    },
  );

  it("continues rejecting unknown request fields", async () => {
    const response = await send("report", {
      version: 0,
      submit: true,
      lateSubmit: "Unexpected field",
      submission,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: ["property lateSubmit should not exist"],
    });
    expect(save).not.toHaveBeenCalled();
  });
});
