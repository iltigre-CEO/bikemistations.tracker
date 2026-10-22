export const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const normalizedName = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const stationNumber = name => String(name).match(/^\s*([A-Za-z]?\d+)\s*-/)?.[1] ?? '';
export function distanceMeters(a, b) {
  const rad = d => d * Math.PI / 180, dlat = rad(b[0] - a[0]), dlon = rad(b[1] - a[1]);
  const x = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
export function progress(stations, visitedIds) {
  const current = stations.filter(s => s.active !== false), set = new Set(visitedIds);
  const visited = current.filter(s => set.has(s.stationId)).length, total = current.length;
  return { total, visited, missing: total - visited, percent: total ? visited / total * 100 : 0 };
}
