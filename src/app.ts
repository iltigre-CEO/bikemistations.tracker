import express from "express";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { BikeMiAuthService } from "./auth-service.js";
import { BikeMiBrowser } from "./bikemi.js";
import { ConnectionStore } from "./db.js";
import { BikeMiSyncService } from "./sync-service.js";
import { fetchStations } from "./stations.js";
import { RateLimit, sameSecret, sessionToken, validToken, SESSION_MS } from "./security.js";

export function createApp(options: {
  accessKey: string;
  store?: ConnectionStore;
  browser?: BikeMiBrowser;
  allowedOrigins?: string[];
  stationFetcher?: typeof fetchStations;
} ) {
  if (options.accessKey.length < 32) throw new Error("Set EXPLORER_ACCESS_KEY to a private key of at least 32 characters. Run npm run key.");
  const app = express(), store = options.store ?? new ConnectionStore();
  const browser = options.browser ?? new BikeMiBrowser();
  const stationFetcher = options.stationFetcher ?? fetchStations;
  const auth = new BikeMiAuthService(store, browser), sync = new BikeMiSyncService(store, browser, stationFetcher);
  const allowed = new Set(options.allowedOrigins ?? []), loginLimit = new RateLimit(), smsLimit = new RateLimit(5, 5 * 60_000);
  const operations = new Set<string>();
  const userId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), otp = z.string().regex(/^\d{4,10}$/);
  if (process.env.BEHIND_PROXY === "true") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(self)");
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      const origin = req.headers.origin;
      const self = `${req.protocol}://${req.get("host")}`;
      if (origin && origin !== self && !allowed.has(origin)) { res.status(403).json({ code: "ORIGIN_DENIED" }); return; }
      if (origin && allowed.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.vary("Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      }
      if (req.method === "OPTIONS") { res.sendStatus(204); return; }
      if (req.method === "POST" && !req.is("application/json")) { res.status(415).json({ code: "JSON_REQUIRED" }); return; }
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true, mode: "node-playwright", apiVersion: 1 }));
  app.post("/api/explorer/login", (req, res) => {
    if (!loginLimit.allow(req.ip ?? "unknown")) { res.status(429).json({ code: "RATE_LIMIT" }); return; }
    if (typeof req.body?.key !== "string" || !sameSecret(req.body.key, options.accessKey)) { res.status(401).json({ code: "UNAUTHORIZED" }); return; }
    const token = sessionToken(options.accessKey);
    res.cookie("bikemi_explorer_session", token, { httpOnly: true, secure: req.secure, sameSite: "strict", maxAge: SESSION_MS, path: "/api" });
    // For a separate GitHub Pages origin: bearer stays in tab sessionStorage.
    res.json({ token, expiresInSeconds: SESSION_MS / 1000 });
  });
  app.use("/api", (req, res, next) => {
    const bearer = req.get("authorization")?.match(/^Bearer ([^ ]+)$/)?.[1];
    const cookie = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("bikemi_explorer_session="))?.split("=")[1];
    if (!validToken(bearer ?? cookie, options.accessKey)) { res.status(401).json({ code: "UNAUTHORIZED" }); return; }
    next();
  });
  const publicConnection = (id: string) => {
    const c = store.get(id);
    return { userId: c.userId, state: c.state, updatedAt: c.updatedAt, errorMessage: c.errorMessage };
  };
  async function exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (operations.has(id)) throw new Error("A BikeMi operation is already running for this user.");
    operations.add(id);
    try { return await operation(); } finally { operations.delete(id); }
  }
  app.post("/api/explorer/logout", (_req, res) => { res.clearCookie("bikemi_explorer_session", { path: "/api" }); res.json({ ok: true }); });
  app.get("/api/explorer/profiles", (_req, res) => res.json({ profiles: store.profiles() }));
  app.get("/api/bikemi/connection/:userId", (req, res) => res.json(publicConnection(userId.parse(req.params.userId))));
  app.post("/api/bikemi/connect/start", async (req, res) => {
    const body = z.object({ userId, phoneNumber: z.string().trim().min(7).max(24) }).parse(req.body);
    if (!smsLimit.allow(body.userId)) { res.status(429).json({ code: "RATE_LIMIT" }); return; }
    let national = body.phoneNumber.replace(/\D/g, "");
    if (national.startsWith("0039")) national = national.slice(4);
    else if (national.startsWith("39") && national.length > 10) national = national.slice(2);
    if (!/^\d{7,14}$/.test(national)) { res.status(400).json({ code: "INVALID_INPUT" }); return; }
    const result = await exclusive(body.userId, () => auth.start(body.userId, `+39${national}`, national));
    res.status(202).json(result);
  });
  app.post("/api/bikemi/connect/verify", async (req, res) => {
    const body = z.object({ userId, authAttemptId: z.string().uuid(), otp }).parse(req.body);
    await exclusive(body.userId, () => auth.verify(body.userId, body.authAttemptId, body.otp));
    res.json(publicConnection(body.userId));
  });
  app.post("/api/bikemi/connect/cancel", async (req, res) => {
    const id = userId.parse(req.body.userId);
    await exclusive(id, () => auth.cancel(id));
    if (store.get(id).state === "WAITING_FOR_SMS") store.set(id, "NOT_CONNECTED");
    res.json(publicConnection(id));
  });
  app.post("/api/bikemi/session/check", async (req, res) => {
    const id = userId.parse(req.body.userId);
    const authenticated = await exclusive(id, () => auth.verifySession(id));
    res.json({ authenticated, connection: publicConnection(id) });
  });
  app.post("/api/bikemi/sync", async (req, res) => {
    const id = userId.parse(req.body.userId);
    const before = store.dashboard(id);
    const result = await exclusive(id, () => sync.sync(id));
    const dashboard = store.dashboard(id);
    res.json({ ...result, newStations: dashboard.visitedStationIds.filter(id => !before.visitedStationIds.includes(id)).length,
      newRides: Math.max(0, dashboard.totalRideCount - before.totalRideCount), dashboard, connection: publicConnection(id) });
  });
  app.get("/api/bikemi/dashboard/:userId", (req, res) => res.json(store.dashboard(userId.parse(req.params.userId))));
  app.get("/api/bikemi/stations", async (_req, res) => {
    try {
      const stations = await stationFetcher();
      if (!stations.length) throw new Error("empty feed");
      store.saveStations(stations); res.json({ stations, live: true });
    } catch {
      res.json({ stations: store.dashboard("__public_catalogue__").stations, live: false, code: "STATION_FEED_UNAVAILABLE" });
    }
  });
  app.post("/api/explorer/reset", async (req, res) => {
    const id = userId.parse(req.body.userId);
    await exclusive(id, async () => store.resetProgress(id));
    res.json(store.dashboard(id));
  });
  app.use("/api", (_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  app.use(express.static(resolve("public"), { dotfiles: "deny", etag: true, setHeaders: res => res.setHeader("Cache-Control", "no-cache") }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const codes: Record<string, string> = {
      "BikeMi session has expired. Reconnect your account.": "SESSION_EXPIRED",
      "BikeMi did not expose recognizable rides on the loaded page.": "NO_RECOGNIZED_RIDES",
      "A BikeMi sync is already running for this user.": "BUSY",
      "A BikeMi operation is already running for this user.": "BUSY",
      "Authentication attempt is invalid or expired. Start again.": "OTP_EXPIRED",
      "BikeMi did not complete OTP verification": "OTP_REJECTED",
      "BikeMi did not confirm authentication.": "OTP_REJECTED",
      "BikeMi OTP field was not found": "PROVIDER_CHANGED",
      "BikeMi phone-number field was not found": "PROVIDER_CHANGED",
      "BikeMi send-code button was not found": "PROVIDER_CHANGED",
      "BikeMi did not show the verification-code screen": "SMS_FAILED",
      "BikeMi login page could not be reached": "PROVIDER_UNREACHABLE"
    };
    const code = err instanceof z.ZodError ? "INVALID_INPUT" : err instanceof Error ? codes[err.message] ?? "REQUEST_FAILED" : "REQUEST_FAILED";
    // Never return/log raw provider exceptions, phone numbers, OTPs or sessions.
    res.status(code === "BUSY" ? 409 : 400).json({ code });
  });
  return { app, store };
}

export function seedPublicStations(store: ConnectionStore) {
  if (store.dashboard("__public_catalogue__").stations.length) return;
  const seed = JSON.parse(readFileSync(resolve("public/data/stations.json"), "utf8"));
  store.saveStations(seed.stations.map((s: Record<string, unknown>) => ({
    stationId: String(s.stationId), name: String(s.name), latitude: Number(s.latitude), longitude: Number(s.longitude),
    bikesAvailable: null, docksAvailable: null, updatedAt: String(seed.capturedAt)
  })));
}
