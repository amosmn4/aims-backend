import type { ConfigService } from "@nestjs/config";

export function validateOpsProduction(config: ConfigService) {
  if (config.get("NODE_ENV") !== "production") return;
  for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
    const value = config.get<string>(name) ?? "";
    if (value.length < 32 || /^(change|replace|example|your[-_])/i.test(value))
      throw new Error(`Set a strong ${name} of at least 32 characters for production.`);
  }
  const raw = config.get<string>("OPS_FRONTEND_URL") ?? "";
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw new Error("Set OPS_FRONTEND_URL to the production HTTPS origin.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("OPS_FRONTEND_URL must be an HTTPS origin without a path or credentials.");
  if (config.get("OPS_EMAIL_JOBS_ENABLED") === true) {
    if (
      !["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"].every((name) =>
        config.get(name),
      )
    )
      throw new Error("Scheduled Ops emails require complete SMTP configuration.");
  }
}
