import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { OverviewData } from "./types";

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => fetchJSON<OverviewData>("/api/overview"),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}
