import { describe, expect, it } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { validateOpsProduction } from "./ops-production-config";

describe("Ops production configuration", () => {
  const ready = {
    NODE_ENV: "production",
    JWT_ACCESS_SECRET: "a".repeat(48),
    JWT_REFRESH_SECRET: "b".repeat(48),
    OPS_FRONTEND_URL: "https://ops.example.test",
    OPS_EMAIL_JOBS_ENABLED: true,
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 587,
    SMTP_USER: "fixture",
    SMTP_PASSWORD: "fixture",
    SMTP_FROM: "Ops <ops@example.test>",
  };
  it("accepts configured production and permits local development", () => {
    expect(() => validateOpsProduction(new ConfigService(ready))).not.toThrow();
    expect(() =>
      validateOpsProduction(new ConfigService({ NODE_ENV: "development" })),
    ).not.toThrow();
  });
  it("rejects weak secrets before listening", () => {
    expect(() =>
      validateOpsProduction(new ConfigService({ ...ready, JWT_ACCESS_SECRET: "short" })),
    ).toThrow("JWT_ACCESS_SECRET");
  });
  it.each([
    "http://ops.example.test",
    "https://ops.example.test/path",
    "https://user:password@ops.example.test",
    "https://ops.example.test?token=value",
  ])("rejects an invalid report origin", (origin) => {
    expect(() =>
      validateOpsProduction(new ConfigService({ ...ready, OPS_FRONTEND_URL: origin })),
    ).toThrow("HTTPS origin");
  });
  it("requires SMTP when scheduled sending is enabled", () => {
    expect(() => validateOpsProduction(new ConfigService({ ...ready, SMTP_HOST: "" }))).toThrow(
      "SMTP",
    );
    expect(() =>
      validateOpsProduction(
        new ConfigService({ ...ready, SMTP_HOST: "", OPS_EMAIL_JOBS_ENABLED: false }),
      ),
    ).not.toThrow();
  });
});
