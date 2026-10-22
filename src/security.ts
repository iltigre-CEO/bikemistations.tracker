import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
export const SESSION_MS = 7 * 24 * 60 * 60_000;
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
export function sessionToken(key: string, now = Date.now()): string {
  const payload = `${now + SESSION_MS}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${createHmac("sha256", key).update(payload).digest("hex")}`;
}
export function validToken(token: string | undefined, key: string, now = Date.now()): boolean {
  if (!token || token.length > 180) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]);
  if (expiry <= now || expiry > now + SESSION_MS + 60_000) return false;
  return sameSecret(parts[2], createHmac("sha256", key).update(parts.slice(0, 2).join(".")).digest("hex"));
}
export class RateLimit {
  private entries = new Map<string, { count: number; reset: number }>();
  constructor(private readonly maximum = 12, private readonly windowMs = 15 * 60_000) {}
  allow(id: string, now = Date.now()): boolean {
    // Cleanup bounds memory usage without keeping IP addresses in files or logs.
    for (const [key, entry] of this.entries) if (entry.reset <= now) this.entries.delete(key);
    const entry = this.entries.get(id) ?? { count: 0, reset: now + this.windowMs };
    entry.count++; this.entries.set(id, entry);
    return entry.count <= this.maximum;
  }
}
