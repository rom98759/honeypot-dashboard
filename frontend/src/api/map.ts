import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { MapData, MapPeriod } from "./types";

export function useMap({ period, live }: { period: MapPeriod; live: boolean }) {
  return useQuery({
    queryKey: ["map", period],
    queryFn: () => fetchJSON<MapData>(`/api/map?period=${period}`),
    refetchInterval: live ? 10_000 : false,
  });
}
