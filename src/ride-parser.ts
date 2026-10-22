import type { Ride } from "./types.js";

export type RideHistoryRow = {
  id?: string;
  text: string;
  values?: string[];
};

// BikeMi has changed the Trips markup before, so the browser extracts visible
// row text and stable data attributes while this parser stays DOM-independent.
export function parseRideRows(userId: string, rows: RideHistoryRow[]): Ride[] {
  const bikeMiRides = parseBikeMiHistory(userId, rows.map((row) => row.text).join("\n"));
  if (bikeMiRides.length) return bikeMiRides;
  return rows.map((row, index) => {
    const values = (row.values ?? row.text.split(/\n|\||\s{2,}/)).map(clean).filter(Boolean);
    const text = values.join(" | ");
    const dateMatches = [...text.matchAll(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}(?:[ ,]+\d{1,2}:\d{2})?\b/g)].map((m) => parseItalianDate(m[0]));
    const stations = values.filter((value) => /(?:station|stazione|dock|parking|\bda\b|\ba\b)/i.test(value))
      .map(stripStationLabel).filter(Boolean);
    const durations = [...text.matchAll(/\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\b/g)];
    const duration = durations.at(-1);
    const durationSeconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3] ?? 0) : null;
    const explicitId = row.id ?? text.match(/(?:ride|trip|corsa|viaggio)\s*(?:id|#)?\s*[:#]?\s*([\w-]{4,})/i)?.[1];
    // A deterministic fingerprint makes repeats idempotent even when the UI
    // does not expose an explicit provider ID. It is scoped to the user.
    const providerRideId = explicitId ?? `derived-${hash(text || String(index))}`;
    return {
      providerRideId,
      userId,
      startedAt: dateMatches[0] ?? null,
      endedAt: dateMatches[1] ?? null,
      durationSeconds,
      startStation: stations[0] ?? null,
      endStation: stations[1] ?? null,
      bikeType: values.find((value) => /e-?bike|electric|classic|mechanical|cargo/i.test(value)) ?? null
    };
  }).filter((ride) => ride.startStation || ride.endStation || ride.startedAt);
}

const italianMonths: Record<string, number> = {
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11
};

function parseBikeMiHistory(userId: string, text: string): Ride[] {
  let activeYear: number | null = null;
  let activeMonth: number | null = null;
  let activeDay: number | null = null;
  const rides: Ride[] = [];
  for (const rawLine of text.split("\n")) {
    const line = clean(rawLine);
    const monthYear = line.match(/^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})$/i);
    if (monthYear) { activeMonth = italianMonths[monthYear[1].toLowerCase()]; activeYear = Number(monthYear[2]); continue; }
    const day = line.match(/^(?:lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)$/i);
    if (day) { activeDay = Number(day[1]); activeMonth = italianMonths[day[2].toLowerCase()]; continue; }
    const trip = line.match(/^(\d{1,2}:\d{2})\s+(.+?)\s+(\d{1,2}:\d{2})\s+(.+?)\s+(\d+)\s+minut[oi]\b/i);
    if (!trip || activeYear === null || activeMonth === null || activeDay === null) continue;
    const startedAt = isoAt(activeYear, activeMonth, activeDay, trip[1]);
    let endedAt = isoAt(activeYear, activeMonth, activeDay, trip[3]);
    if (startedAt && endedAt && endedAt < startedAt) endedAt = new Date(new Date(endedAt).valueOf() + 86_400_000).toISOString();
    const startStation = clean(trip[2]);
    const endStation = clean(trip[4]);
    const durationSeconds = Number(trip[5]) * 60;
    rides.push({ providerRideId: `derived-${hash([startedAt, endedAt, startStation, endStation, durationSeconds].join("|"))}`, userId, startedAt, endedAt, durationSeconds, startStation, endStation, bikeType: null });
  }
  return rides;
}

function isoAt(year: number, month: number, day: number, value: string): string | null {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(Date.UTC(year, month, day, hours, minutes));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function clean(value: string) { return value.replace(/\s+/g, " ").trim(); }
function stripStationLabel(value: string) { return clean(value.replace(/^(?:start|end|from|to|station|stazione|dock|parking|da|a)\s*:?\s*/i, "")); }
function hash(value: string) { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return (result >>> 0).toString(36); }
function parseItalianDate(value: string): string | null {
  const match = value.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] ?? 0), Number(match[5] ?? 0)));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
