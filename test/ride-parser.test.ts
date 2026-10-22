import { describe, expect, it } from "vitest";
import { parseRideRows } from "../src/ride-parser.js";

describe("BikeMi ride history parser", () => {
  it("normalizes visible trip rows and creates a deterministic fallback ID", () => {
    const [ride] = parseRideRows("family-user", [{
      text: "12/09/2026 08:30 | 12/09/2026 08:51 | 00:21:00 | Stazione: Duomo | Stazione: Cadorna | E-bike"
    }]);

    expect(ride).toMatchObject({
      userId: "family-user", providerRideId: expect.stringMatching(/^derived-/), durationSeconds: 1260,
      startStation: "Duomo", endStation: "Cadorna", bikeType: "E-bike",
      startedAt: "2026-09-12T08:30:00.000Z", endedAt: "2026-09-12T08:51:00.000Z"
    });
  });

  it("uses a provider identifier when BikeMi exposes one", () => {
    const [ride] = parseRideRows("family-user", [{ id: "trip-483", text: "14/09/2026 09:00 | Stazione: Duomo" }]);
    expect(ride.providerRideId).toBe("trip-483");
  });

  it("parses BikeMi's live Italian history rows", () => {
    const rides = parseRideRows("family-user", [{ text: `Cronologia utilizzi
settembre 2026
lunedì 21 settembre
16:26 6 - San Giorgio\t16:38 192 - Col di Lana - Col Moschin\t11 minuti\t1 km` }]);
    expect(rides).toEqual([expect.objectContaining({ startStation: "6 - San Giorgio", endStation: "192 - Col di Lana - Col Moschin", durationSeconds: 660, startedAt: "2026-09-21T16:26:00.000Z" })]);
  });
});
