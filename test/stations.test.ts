import { describe, expect, it, vi } from "vitest";
import { fetchStations } from "../src/stations.js";

describe("BikeMi GBFS stations", () => {
  it("joins public station information and availability", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { stations: [{ station_id: "1", name: "Duomo", lat: 45.464, lon: 9.19 }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ last_updated: 1_789_000_000, data: { stations: [{ station_id: "1", num_bikes_available: 4, num_docks_available: 7 }] } }) });
    await expect(fetchStations(fetcher as typeof fetch)).resolves.toEqual([expect.objectContaining({ stationId: "1", name: "Duomo", bikesAvailable: 4, docksAvailable: 7 })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
