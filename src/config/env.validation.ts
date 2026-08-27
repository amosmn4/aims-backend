import { z } from "zod";

// Fails at boot with a clear message instead of at the first request that happens to touch
// a missing/misspelled variable — see .env.example for what each of these is for.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  // Sliding inactivity timeout — every successful /auth/refresh rolls this forward. No API
  // activity for this long (tab idle/closed/asleep) and the session is gone.
  JWT_IDLE_TTL: z.string().default("2h"),
  // Absolute ceiling from the moment of login, independent of activity — even a continuously
  // active session must fully re-login after this long.
  JWT_REFRESH_TTL: z.string().default("7d"),

  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // No default here — main.ts falls back to a hardcoded localhost origin only when this is
  // genuinely absent from the environment, so that fallback logic lives in exactly one place.
  CORS_ORIGIN: z.string().min(1).optional(),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(1).optional(),

  // Website Analytics (GA4). Both optional — the app boots and the feature degrades to a
  // "not connected" state when either is unset; see marketing/website-analytics.
  GA4_PROPERTY_ID: z.string().min(1).optional(),
  GA4_SERVICE_ACCOUNT_KEY_JSON: z.string().min(1).optional(),

  // Object storage (S3-compatible — AWS S3, MinIO, R2, Spaces via S3_ENDPOINT). All optional —
  // uploads fall back to local disk (uploads/, gitignored) when unset; see storage/storage.service.
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().min(1).optional(),

  // SMTP for notification email digests. Optional — the digest cron sends nothing (and logs a
  // warning) when unset; see notifications/email/email.service.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),

  // Shared secret the amsol.africa website authenticates with to call the public blog feed +
  // engagement endpoints (GET /public/blog/feed, POST /public/blog/engagement) — see
  // marketing/blog/public-blog-api-key.guard.ts. Image/video streaming stays unauthenticated
  // (plain <img>/<video> tags can't send custom headers). Optional at boot so the app still
  // starts without it, but those two routes reject every request until it's set.
  PUBLIC_BLOG_API_KEY: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

// CORS_ORIGIN accepts one or more origins as a comma-separated list (e.g.
// "https://management.amsol.africa,http://localhost:5173"). Centralized here so main.ts (needs
// the full list to match the request's Origin header against) and UsersService (needs a single
// "primary" URL to build password-setup/invite email links) can't drift on how it's split — and
// so main.ts never passes the raw joined string straight to `cors`'s `origin` option, which
// does a strict-equality match against a *string* value and would then reject every real origin.
export function parseCorsOrigins(raw: string | undefined): string[] {
  return raw
    ? raw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : ["http://localhost:3000"];
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  // `KEY=""` in .env (the placeholder style .env.example uses for every optional integration)
  // parses as the empty string, not undefined — `.optional()` only forgives a key that's absent
  // entirely, so every optional `.min(1)` field above was failing boot the moment its placeholder
  // was left blank instead of removed. Blank out to undefined here so "unset" and "set to empty"
  // are treated the same, once, for every field, instead of relaxing each schema individually.
  const withBlanksStripped = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const result = envSchema.safeParse(withBlanksStripped);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
