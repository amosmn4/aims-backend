/** Matches what jsonwebtoken's `expiresIn` actually accepts (unit-suffixed durations) — not
 * tied to one specific unit, so JWT_ACCESS_TTL/JWT_REFRESH_TTL can each use whichever reads best
 * ("15m", "24h", "7d", ...). */
export type TtlString = `${number}${"s" | "m" | "h" | "d"}`;

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "24h" / "15m" / "7d" / "30s" -> milliseconds. Used to keep the refresh cookie's browser-level
 * Max-Age in lockstep with JWT_REFRESH_TTL, instead of a separately hardcoded literal. */
export function parseTtlToMs(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL string: "${ttl}" (expected e.g. "24h", "7d")`);
  return Number(match[1]) * UNIT_MS[match[2]];
}
