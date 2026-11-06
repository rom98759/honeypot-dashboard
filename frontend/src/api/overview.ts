import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { HeatmapData, OverviewData, OverviewPeriod } from "./types";

export function overviewUrl(period: OverviewPeriod, filter = ""): string {
  const params = new URLSearchParams({ period });
  if (filter) params.set("filter", filter);
  return `/api/overview?${params.toString()}`;
}

// Mirrors the server cache TTL per period: polling faster would only fetch the same cached body.
const REFETCH_MS: Record<OverviewPeriod, number> = { "24h": 10_000, "7d": 30_000, "30d": 60_000, all: 60_000 };

export function overviewRefetchInterval(period: OverviewPeriod): number {
  return REFETCH_MS[period];
}

export function useOverview(period: OverviewPeriod = "24h", filter = "") {
  return useQuery({
    queryKey: ["overview", period, filter],
    queryFn: () => fetchJSON<OverviewData>(overviewUrl(period, filter)),
    refetchInterval: overviewRefetchInterval(period),
    refetchIntervalInBackground: false,
    // Changing a filter keeps the previous numbers on screen instead of flashing the skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useOverviewHeatmap() {
  return useQuery({
    queryKey: ["overview", "heatmap"],
    queryFn: () => fetchJSON<HeatmapData>("/api/overview/heatmap"),
    staleTime: 5 * 60_000,
  });
}
