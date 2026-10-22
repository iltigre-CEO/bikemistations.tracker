import type { Station } from "./types.js";

const GBFS_ROOT = "https://gbfs.urbansharing.com/bikemi.com";
type Feed<T> = { last_updated?: number; data: T };

export async function fetchStations(fetcher: typeof fetch = fetch): Promise<Station[]> {
  const headers = { "Client-Identifier": process.env.BIKEMI_CLIENT_IDENTIFIER ?? "bikemi-station-tracker" };
  const [information, status] = await Promise.all([
    fetchJson<Feed<{ stations: Array<{ station_id: string; name: string; lat: number; lon: number }> }>>(`${GBFS_ROOT}/station_information.json`, headers, fetcher),
    fetchJson<Feed<{ stations: Array<{ station_id: string; num_bikes_available?: number; num_docks_available?: number }> }>>(`${GBFS_ROOT}/station_status.json`, headers, fetcher)
  ]);
  const byId = new Map(status.data.stations.map((station) => [station.station_id, station]));
  const capturedAt = new Date((status.last_updated ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  return information.data.stations.map((station) => {
    const availability = byId.get(station.station_id);
    return { stationId: station.station_id, name: station.name, latitude: station.lat, longitude: station.lon, bikesAvailable: availability?.num_bikes_available ?? null, docksAvailable: availability?.num_docks_available ?? null, updatedAt: capturedAt };
  });
}

async function fetchJson<T>(url: string, headers: Record<string, string>, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("BikeMi station data is temporarily unavailable.");
  return response.json() as Promise<T>;
}
