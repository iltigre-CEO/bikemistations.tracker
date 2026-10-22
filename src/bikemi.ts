import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { RideHistoryRow } from "./ride-parser.js";

/** Deliberately contains no OTP logging or persistence. Update selectors only after manual site validation. */
export class BikeMiBrowser {
  private activeProfiles = new Set<string>();
  constructor(private readonly root = process.env.BIKEMI_SESSION_DIR ?? "data/bikemi_sessions") { mkdirSync(root, { recursive: true }); }

  async open(userId: string): Promise<{ context: BrowserContext; page: Page }> {
    // userId must be an internal UUID/identifier, never a phone number or display name.
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error("Invalid local user id");
    if (this.activeProfiles.has(userId)) throw new Error("A BikeMi operation is already running for this user.");
    this.activeProfiles.add(userId);
    try {
      const context = await chromium.launchPersistentContext(join(this.root, userId), { headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
      context.once("close", () => this.activeProfiles.delete(userId));
      return { context, page: context.pages()[0] ?? await context.newPage() };
    } catch (error) { this.activeProfiles.delete(userId); throw error; }
  }

  async requestSms(page: Page, phoneNumber: string): Promise<void> {
    // A user explicitly starting a new connection needs a clean provider state.
    // This affects only their dedicated BikeMi profile and prevents stale OTP pages
    // from blocking a fresh SMS request after an interrupted verification.
    await page.context().clearCookies();
    await page.goto("https://bikemi.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    try {
      await page.goto(process.env.BIKEMI_LOGIN_URL ?? "https://bikemi.com/log-in", { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch { throw new Error("BikeMi login page could not be reached"); }
    // BikeMi's login has a separately selected +39 country code and a national-number input.
    try {
      await page.locator('input[name="nationalPhoneNumber"]').fill(phoneNumber);
    } catch { throw new Error("BikeMi phone-number field was not found"); }
    try {
      // BikeMi currently sets role="alert" on this submit button, so role-based button lookup fails.
      await page.locator('form#create-verification-form button[type="submit"]').click();
    } catch { throw new Error("BikeMi send-code button was not found"); }
    try {
      await page.getByLabel(/code|codice|verification/i).waitFor({ state: "visible", timeout: 20_000 });
    } catch { throw new Error("BikeMi did not show the verification-code screen"); }
  }

  async submitOtp(page: Page, otp: string): Promise<void> {
    try { await page.getByLabel(/code|codice|verification/i).fill(otp); }
    catch { throw new Error("BikeMi OTP field was not found"); }
    // BikeMi has no OTP submit button. Its digit input automatically submits as soon
    // as the complete code is entered. Wait for that asynchronous request to finish.
    try { await page.locator('form#enter-code-form').waitFor({ state: "detached", timeout: 15_000 }); }
    catch { throw new Error("BikeMi did not complete OTP verification"); }
  }

  async hasRideHistory(page: Page): Promise<boolean> {
    await page.goto(process.env.BIKEMI_RIDE_HISTORY_URL ?? "https://bikemi.com/profile/trips", { waitUntil: "domcontentloaded", timeout: 30_000 });
    // The protected page redirects unauthenticated visitors to /log-in. Give the
    // client-side authentication guard time to settle before judging the session.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    const pathname = new URL(page.url()).pathname.replace(/\/$/, "");
    return pathname === "/profile/trips" &&
      await page.locator('input[name="nationalPhoneNumber"]').isHidden().catch(() => true);
  }

  async rideHistoryRows(page: Page): Promise<RideHistoryRow[]> {
    // sync() has just confirmed this page with hasRideHistory(). Navigating a
    // second time can hang behind BikeMi's long-lived client requests, so read
    // the authenticated document already on screen instead.
    await page.waitForTimeout(500);
    // The live page renders history rows as div-based text rather than table
    // rows or stable trip attributes. Preserve the visible history text; the
    // parser recognizes BikeMi's date/time/duration row format.
    return [{ text: await page.evaluate(() => document.body.innerText) }];
  }
}
