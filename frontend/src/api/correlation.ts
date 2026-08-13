import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { CorrelationRow } from "./types";

export function useCorrelation() {
  return useQuery({
    queryKey: ["correlation"],
    queryFn: () => fetchJSON<CorrelationRow[]>("/api/correlation"),
  });
}
