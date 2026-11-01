import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { HealthData } from "./types";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJSON<HealthData>("/api/health"),
    // The server only flags a source after 60 s of unread data; polling faster adds nothing.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
