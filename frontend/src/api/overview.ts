import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { OverviewData, OverviewPeriod } from "./types";

export function useOverview(period: OverviewPeriod = "24h") {
  return useQuery({
    queryKey: ["overview", period],
    queryFn: () => fetchJSON<OverviewData>(`/api/overview?period=${period}`),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}
