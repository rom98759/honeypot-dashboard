import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { Filters, HeatmapData, OverviewData, OverviewPeriod } from "./types";

export function overviewUrl(period: OverviewPeriod, filters: Filters = {}): string {
  const params = new URLSearchParams({ period });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `/api/overview?${params.toString()}`;
}

export function useOverview(period: OverviewPeriod = "24h", filters: Filters = {}) {
  return useQuery({
    queryKey: ["overview", period, filters],
    queryFn: () => fetchJSON<OverviewData>(overviewUrl(period, filters)),
    refetchInterval: 10_000,
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
