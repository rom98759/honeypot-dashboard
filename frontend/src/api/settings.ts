import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, fetchJSON } from "./client";

export interface AdminNetwork {
  cidr: string;
  note: string | null;
  created_at: string;
}

export interface AdminNetworks {
  items: AdminNetwork[];
  env: string[];
}

const URL = "/api/settings/admin-ips";
const KEY = ["settings", "admin-ips"];

export function useAdminIps() {
  return useQuery({ queryKey: KEY, queryFn: () => fetchJSON<AdminNetworks>(URL) });
}

export function useAddAdminIp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ value, note }: { value: string; note: string }) => {
      const response = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, note }),
      });
      if (!response.ok) throw new ApiError(URL, response.status);
    },
    // Protection changes what the IP pages show (Ban button vs "Protégée").
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useRemoveAdminIp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cidr: string) => {
      const url = `${URL}?cidr=${encodeURIComponent(cidr)}`;
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) throw new ApiError(url, response.status);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
