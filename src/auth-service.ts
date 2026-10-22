import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { BikeMiBrowser } from "./bikemi.js";
import { ConnectionStore } from "./db.js";
import type { Connection } from "./types.js";

type Attempt = { userId: string; page: Page; context: BrowserContext; expiresAt: number; verifying: boolean; timer: ReturnType<typeof setTimeout> };
const ATTEMPT_TTL_MS = 5 * 60_000;

export class BikeMiAuthService {
  private attempts = new Map<string, Attempt>();
  constructor(private readonly store: ConnectionStore, private readonly browser: BikeMiBrowser) {}

  async start(userId: string, phoneNumber: string, browserPhoneNumber = phoneNumber): Promise<{ authAttemptId: string; status: "WAITING_FOR_SMS" }> {
    await this.closeAttemptsForUser(userId);
    const { context, page } = await this.browser.open(userId);
    try {
      await this.browser.requestSms(page, browserPhoneNumber);
      const authAttemptId = randomUUID();
      const timer = setTimeout(() => { void this.dispose(authAttemptId); }, ATTEMPT_TTL_MS);
      timer.unref();
      this.attempts.set(authAttemptId, { userId, page, context, expiresAt: Date.now() + ATTEMPT_TTL_MS, verifying: false, timer });
      this.store.set(userId, "WAITING_FOR_SMS", phoneNumber);
      return { authAttemptId, status: "WAITING_FOR_SMS" };
    } catch (error) {
      await context.close();
      this.store.set(userId, "AUTHENTICATION_FAILED", phoneNumber, "BikeMi could not send a verification code.");
      // Deliberately log only our fixed phase message—never a phone number, OTP, or provider exception.
      console.warn("BikeMi authentication start failed");
      throw error;
    }
  }

  async verify(userId: string, authAttemptId: string, otp: string): Promise<Connection> {
    const attempt = this.attempts.get(authAttemptId);
    if (!attempt || attempt.userId !== userId || attempt.expiresAt < Date.now() || attempt.verifying) {
      if (attempt) await this.dispose(authAttemptId);
      throw new Error("Authentication attempt is invalid or expired. Start again.");
    }
    attempt.verifying = true;
    try {
      await this.browser.submitOtp(attempt.page, otp); // otp is never logged or persisted
      if (!await this.browser.hasRideHistory(attempt.page)) throw new Error("BikeMi did not confirm authentication.");
      const connection = this.store.set(userId, "CONNECTED");
      await this.dispose(authAttemptId);
      return connection;
    } catch (error) {
      await this.dispose(authAttemptId);
      this.store.set(userId, "AUTHENTICATION_FAILED", this.store.get(userId).phoneNumber, "The verification code was rejected or expired.");
      // Fixed diagnostic only; never log the OTP, phone number, or raw provider error.
      console.warn("BikeMi authentication verification failed");
      throw error;
    }
  }

  async verifySession(userId: string): Promise<boolean> {
    const { context, page } = await this.browser.open(userId);
    try {
      const valid = await this.browser.hasRideHistory(page);
      this.store.set(userId, valid ? "CONNECTED" : "SESSION_EXPIRED");
      return valid;
    } finally { await context.close(); }
  }

  async cancel(userId: string) { await this.closeAttemptsForUser(userId); }

  private async closeAttemptsForUser(userId: string) { await Promise.all([...this.attempts].filter(([, a]) => a.userId === userId).map(([id]) => this.dispose(id))); }
  private async dispose(id: string) { const attempt = this.attempts.get(id); this.attempts.delete(id); if (attempt) clearTimeout(attempt.timer); await attempt?.context.close(); }
}
