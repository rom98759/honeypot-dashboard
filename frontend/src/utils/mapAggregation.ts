import type { MapEvent } from "../api/types";

export interface HeatPoint {
  latitude: number;
  longitude: number;
  count: number;
}

export function pointKey(p: { latitude: number; longitude: number }): string {
  return `${p.latitude},${p.longitude}`;
}

export function aggregateMapEvents(events: MapEvent[], cutoff: string | null): HeatPoint[] {
  const counts = new Map<string, HeatPoint>();
  for (const event of events) {
    if (cutoff !== null && event.connect_time > cutoff) continue;
    const key = pointKey(event);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { latitude: event.latitude, longitude: event.longitude, count: 1 });
    }
  }
  return [...counts.values()];
}
