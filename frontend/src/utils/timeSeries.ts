import type { OverviewPeriod } from "../api/types";
import { nextBucketBoundary } from "./bucket";

export interface SeriesPoint {
  key: string;
  label: string;
  title: string;
  n: number;
  logins: number;
  /** Inclusive lower / exclusive upper connect_time bounds for the Sessions page. */
  from: string;
  to: string;
}

type Unit = "hour" | "day" | "month";

const MONTHLY_THRESHOLD_DAYS = 120;
const DAY_MS = 86_400_000;

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function keyToDate(key: string, unit: Unit): Date {
  if (unit === "hour") return new Date(`${key}:00:00Z`);
  if (unit === "day") return new Date(`${key}T00:00:00Z`);
  return new Date(`${key}-01T00:00:00Z`);
}

function labels(key: string, unit: Unit): { label: string; title: string } {
  const d = keyToDate(key, unit);
  if (unit === "hour") {
    return {
      label: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      title: d.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
    };
  }
  if (unit === "day") {
    return {
      label: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }),
      title: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
    };
  }
  return {
    label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }),
    title: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

function step(key: string, unit: Unit): string {
  if (unit === "month") return nextMonth(key);
  return nextBucketBoundary(key);
}

/**
 * Turns the sparse backend timeline into a continuous series (empty buckets at zero), like
 * Umami's generateTimeSeries. The backend groups 24h/7d by hour and 30d/all by day; 7d is
 * re-grouped by day and long "all" ranges by month so the bar chart stays readable.
 */
export function buildSeries(
  timeline: { bucket: string; n: number; logins?: number }[],
  period: OverviewPeriod,
  now: Date = new Date()
): SeriesPoint[] {
  const nowIso = now.toISOString();
  let unit: Unit = period === "24h" ? "hour" : "day";
  let first: string;
  const last = unit === "hour" ? nowIso.slice(0, 13) : nowIso.slice(0, 10);

  if (period === "24h") first = new Date(now.getTime() - 23 * 3_600_000).toISOString().slice(0, 13);
  else if (period === "7d") first = new Date(now.getTime() - 6 * DAY_MS).toISOString().slice(0, 10);
  else if (period === "30d") first = new Date(now.getTime() - 29 * DAY_MS).toISOString().slice(0, 10);
  else {
    if (!timeline.length) return [];
    first = timeline.map((t) => t.bucket.slice(0, 10)).sort()[0];
    const days = (keyToDate(last, "day").getTime() - keyToDate(first, "day").getTime()) / DAY_MS;
    if (days > MONTHLY_THRESHOLD_DAYS) unit = "month";
  }

  const keyLength = unit === "hour" ? 13 : unit === "day" ? 10 : 7;
  const firstKey = first.slice(0, keyLength);
  const lastKey = last.slice(0, keyLength);

  const totals = new Map<string, { n: number; logins: number }>();
  for (const t of timeline) {
    const key = t.bucket.slice(0, keyLength);
    const acc = totals.get(key) ?? { n: 0, logins: 0 };
    acc.n += t.n;
    acc.logins += t.logins ?? 0;
    totals.set(key, acc);
  }

  const points: SeriesPoint[] = [];
  for (let key = firstKey; key <= lastKey; key = step(key, unit)) {
    const acc = totals.get(key) ?? { n: 0, logins: 0 };
    points.push({ key, ...labels(key, unit), ...acc, from: key, to: step(key, unit) });
  }
  return points;
}
