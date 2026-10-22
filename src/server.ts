import { createApp, seedPublicStations } from "./app.js";
const { app, store } = createApp({
  accessKey: process.env.EXPLORER_ACCESS_KEY ?? "",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)
});
seedPublicStations(store);
const server = app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1", () => console.log("BikeMi Explorer: Node + Playwright backend ready"));
function shutdown() { server.close(() => { store.close(); process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
