import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";

export interface AppConfig {
  sshd_port: number | null;
  ban_enabled: boolean;
}

export function useAppConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => fetchJSON<AppConfig>("/api/config"),
    staleTime: Infinity,
  });
}
