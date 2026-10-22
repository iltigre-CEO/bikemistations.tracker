import { BikeMiBrowser } from "./bikemi.js";
import { ConnectionStore } from "./db.js";
import { parseRideRows } from "./ride-parser.js";
import { fetchStations } from "./stations.js";

export class BikeMiSyncService {
  private syncing = new Set<string>();
  constructor(private readonly store: ConnectionStore, private readonly browser: BikeMiBrowser, private readonly stationFetcher: typeof fetchStations = fetchStations) {}

  async sync(userId: string): Promise<{ rideCount: number; stationCount: number; warning: string | null; historyScope: string }> {
    if (this.syncing.has(userId)) throw new Error("A BikeMi sync is already running for this user.");
    this.syncing.add(userId);
    try {
      const { context, page } = await this.browser.open(userId);
      try {
        if (!await this.browser.hasRideHistory(page)) {
          this.store.set(userId, "SESSION_EXPIRED");
          throw new Error("BikeMi session has expired. Reconnect your account.");
        }
        const rows = await this.browser.rideHistoryRows(page);
        let warning: string | null = null;
        // An outage of the PUBLIC feed must not discard successfully read private history.
        const stations = await this.stationFetcher().catch(() => {
          warning = "STATION_FEED_UNAVAILABLE";
          return [];
        });
        const rides = parseRideRows(userId, rows);
        if (!rides.length) throw new Error("BikeMi did not expose recognizable rides on the loaded page.");
        this.store.saveRides(rides);
        if (stations.length) this.store.saveStations(stations);
        this.store.set(userId, "CONNECTED");
        this.store.finishSync(userId, "SUCCESS", rides.length);
        return { rideCount: rides.length, stationCount: stations.length, warning: rides.length ? warning : "NO_RECOGNIZED_RIDES", historyScope: "loaded-page" };
      } finally { await context.close(); }
    } catch (error) {
      // Keep diagnostics free of provider details, which can contain account data.
      console.warn("BikeMi sync failed");
      this.store.finishSync(userId, "ERROR", 0, "BikeMi sync could not be completed.");
      throw error;
    } finally { this.syncing.delete(userId); }
  }
}
