import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Connection, ConnectionState, Ride, Station } from "./types.js";

export class ConnectionStore {
  private readonly db: Database.Database;

  constructor(filename = process.env.DATABASE_PATH ?? "data/bikemi.sqlite") {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.exec(`CREATE TABLE IF NOT EXISTS bikemi_connections (
      user_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      phone_number TEXT,
      updated_at TEXT NOT NULL,
      error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS rides (
      user_id TEXT NOT NULL,
      provider_ride_id TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      duration_seconds INTEGER,
      start_station TEXT,
      end_station TEXT,
      bike_type TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (user_id, provider_ride_id)
    );
    CREATE TABLE IF NOT EXISTS station_snapshots (
      station_id TEXT NOT NULL,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      bikes_available INTEGER,
      docks_available INTEGER,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (station_id, captured_at)
    );
    CREATE TABLE IF NOT EXISTS bikemi_syncs (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT,
      ride_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS explorer_visits (
      user_id TEXT NOT NULL, station_id TEXT NOT NULL, first_seen_at TEXT NOT NULL,
      PRIMARY KEY (user_id, station_id)
    );
    CREATE TABLE IF NOT EXISTS explorer_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS explorer_successful_syncs (
      user_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, ride_count INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO explorer_successful_syncs(user_id,completed_at,ride_count)
      SELECT user_id,completed_at,ride_count FROM bikemi_syncs WHERE status='SUCCESS' AND completed_at IS NOT NULL;`);
  }

  get(userId: string): Connection {
    const existing = this.db.prepare("SELECT * FROM bikemi_connections WHERE user_id = ?").get(userId) as Record<string, string | null> | undefined;
    if (!existing) return { userId, state: "NOT_CONNECTED", phoneNumber: null, updatedAt: new Date().toISOString(), errorMessage: null };
    return this.row(existing);
  }

  set(userId: string, state: ConnectionState, phoneNumber: string | null = this.get(userId).phoneNumber, errorMessage: string | null = null): Connection {
    const updatedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO bikemi_connections(user_id,state,phone_number,updated_at,error_message)
      VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state, phone_number=excluded.phone_number, updated_at=excluded.updated_at, error_message=excluded.error_message`)
      .run(userId, state, phoneNumber, updatedAt, errorMessage);
    return { userId, state, phoneNumber, updatedAt, errorMessage };
  }

  private row(row: Record<string, string | null>): Connection {
    return { userId: row.user_id!, state: row.state as ConnectionState, phoneNumber: row.phone_number, updatedAt: row.updated_at!, errorMessage: row.error_message };
  }

  saveRides(rides: Ride[]): number {
    const syncedAt = new Date().toISOString();
    const insert = this.db.prepare(`INSERT OR REPLACE INTO rides(user_id,provider_ride_id,started_at,ended_at,duration_seconds,start_station,end_station,bike_type,synced_at)
      VALUES(@userId,@providerRideId,@startedAt,@endedAt,@durationSeconds,@startStation,@endStation,@bikeType,@syncedAt)
      `);
    const transaction = this.db.transaction((items: Ride[]) => items.forEach((ride) => insert.run({ ...ride, syncedAt })));
    transaction(rides);
    return rides.length;
  }

  saveStations(stations: Station[]): void {
    const insert = this.db.prepare(`INSERT OR REPLACE INTO station_snapshots(station_id,name,latitude,longitude,bikes_available,docks_available,captured_at)
      VALUES(@stationId,@name,@latitude,@longitude,@bikesAvailable,@docksAvailable,@updatedAt)`);
    const transaction = this.db.transaction((items: Station[]) => items.forEach((station) => insert.run(station)));
    if (!stations.length) return;
    transaction(stations);
    this.db.prepare("INSERT OR REPLACE INTO explorer_metadata(key,value) VALUES('active_station_ids',?)")
      .run(JSON.stringify(stations.map(s => s.stationId)));
  }

  finishSync(userId: string, status: "SUCCESS" | "ERROR", rideCount: number, errorMessage: string | null = null): void {
    this.db.prepare(`INSERT INTO bikemi_syncs(user_id,status,completed_at,ride_count,error_message) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at, ride_count=excluded.ride_count, error_message=excluded.error_message`)
      .run(userId, status, new Date().toISOString(), rideCount, errorMessage);
    if (status === "SUCCESS") this.db.prepare("INSERT OR REPLACE INTO explorer_successful_syncs VALUES(?,?,?)")
      .run(userId, new Date().toISOString(), rideCount);
  }

  dashboard(userId: string): { stations: Station[]; lastSync: { completedAt: string; rideCount: number } | null; visitedStationIds: string[]; totalRideCount: number; lastAttempt: { status: string; completedAt: string } | null } {
    const stations = this.db.prepare(`SELECT s.station_id, s.name, s.latitude, s.longitude, s.bikes_available, s.docks_available, s.captured_at
      FROM station_snapshots s JOIN (SELECT station_id, MAX(captured_at) AS captured_at FROM station_snapshots GROUP BY station_id) latest
      ON latest.station_id=s.station_id AND latest.captured_at=s.captured_at ORDER BY s.name`).all() as Array<Record<string, string | number | null>>;
    const sync = this.db.prepare("SELECT completed_at, ride_count FROM explorer_successful_syncs WHERE user_id = ?").get(userId) as Record<string, string | number> | undefined;
    const visitedNames = this.db.prepare(`SELECT start_station AS name FROM rides WHERE user_id = ? AND start_station IS NOT NULL
      UNION SELECT end_station AS name FROM rides WHERE user_id = ? AND end_station IS NOT NULL`).all(userId, userId) as Array<{ name: string }>;
    const network = this.db.prepare("SELECT value FROM explorer_metadata WHERE key='active_station_ids'").get() as {value: string} | undefined;
    const activeIds = network ? new Set(JSON.parse(network.value) as string[]) : null;
    const mappedStations = stations.map((s) => ({ stationId: String(s.station_id), name: String(s.name), latitude: Number(s.latitude), longitude: Number(s.longitude), bikesAvailable: s.bikes_available === null ? null : Number(s.bikes_available), docksAvailable: s.docks_available === null ? null : Number(s.docks_available), updatedAt: String(s.captured_at), active: activeIds ? activeIds.has(String(s.station_id)) : true }));
    // Resolve only unique station names/numbers from the provider's stored rides.
    // Preserve IDs already discovered even when the public station name changes.
    const resolved = new Set<string>();
    for (const reference of visitedNames) {
      const exact = mappedStations.filter(s => stationKey(s.name) === stationKey(reference.name));
      if (exact.length === 1) { resolved.add(exact[0].stationId); continue; }
      const number = reference.name.match(/^\s*(\d+)\s*-/)?.[1];
      if (number) {
        const numbered = mappedStations.filter(s => Number(s.name.match(/^\s*(\d+)\s*-/)?.[1]) === Number(number));
        if (numbered.length === 1) resolved.add(numbered[0].stationId);
      }
    }
    const insertVisit = this.db.prepare("INSERT OR IGNORE INTO explorer_visits VALUES(?,?,?)");
    for (const id of resolved) insertVisit.run(userId, id, new Date().toISOString());
    const visits = this.db.prepare("SELECT station_id FROM explorer_visits WHERE user_id=?").all(userId) as {station_id: string}[];
    const total = this.db.prepare("SELECT COUNT(*) AS count FROM rides WHERE user_id=?").get(userId) as {count: number};
    const attempt = this.db.prepare("SELECT status,completed_at FROM bikemi_syncs WHERE user_id=?").get(userId) as {status: string; completed_at: string} | undefined;
    return {
      stations: mappedStations,
      lastSync: sync ? { completedAt: String(sync.completed_at), rideCount: Number(sync.ride_count) } : null,
      visitedStationIds: visits.map(v => v.station_id),
      totalRideCount: total.count,
      lastAttempt: attempt ? { status: attempt.status, completedAt: attempt.completed_at } : null
    };
  }
  profiles(): string[] {
    return (this.db.prepare("SELECT user_id FROM bikemi_connections UNION SELECT user_id FROM rides ORDER BY user_id")
      .all() as {user_id: string}[]).map(x => x.user_id);
  }
  resetProgress(userId: string): void {
    this.db.transaction(() => {
      for (const table of ["rides", "explorer_visits", "bikemi_syncs", "explorer_successful_syncs"])
        this.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);
    })();
  }
  close(): void { this.db.close(); }
}

function stationKey(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/^\s*\d+\s*-\s*/, "").replace(/^(?:station|stazione)\s*:?[\s-]*/i, "")
    .replace(/[^a-z0-9]/g, "");
}
