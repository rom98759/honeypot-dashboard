import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJSON, postJSON } from "./client";
import type { ActiveBan, IpSummary, PaginatedFail2ban, PaginatedSshdAuth } from "./types";

export const IP_PAGE_SIZE = 25;

export function useIpSummary(ip: string) {
  return useQuery({
    queryKey: ["ip-summary", ip],
    queryFn: () => fetchJSON<IpSummary>(`/api/ip/${encodeURIComponent(ip)}/summary`),
    refetchInterval: (query) => (query.state.data?.enrichment_status === "pending" ? 5000 : false),
  });
}

export function useIpFail2ban(ip: string, page: number) {
  const offset = (page - 1) * IP_PAGE_SIZE;
  return useQuery({
    queryKey: ["ip-fail2ban", ip, page],
    queryFn: () =>
      fetchJSON<PaginatedFail2ban>(
        `/api/ip/${encodeURIComponent(ip)}/fail2ban?limit=${IP_PAGE_SIZE}&offset=${offset}`
      ),
  });
}

export function useIpSshdAuth(ip: string, page: number) {
  const offset = (page - 1) * IP_PAGE_SIZE;
  return useQuery({
    queryKey: ["ip-sshd-auth", ip, page],
    queryFn: () =>
      fetchJSON<PaginatedSshdAuth>(
        `/api/ip/${encodeURIComponent(ip)}/sshd-auth?limit=${IP_PAGE_SIZE}&offset=${offset}`
      ),
  });
}

interface BanResponse {
  currently_banned: boolean;
}

/** "services" keeps the honeypot open to the IP (we keep observing it), "all" closes everything. */
export type BanScope = "services" | "all";

// Mirrors the manual jails in scripts/fail2ban/honeypot.local.tmpl.
const MANUAL_BAN_SECONDS = 7 * 86400;

function manualBan(scope: BanScope): ActiveBan {
  const now = Date.now();
  return {
    jail: scope === "all" ? "manual-all" : "manual",
    banned_at: new Date(now).toISOString(),
    expires_at: new Date(now + MANUAL_BAN_SECONDS * 1000).toISOString(),
    scope,
  };
}

export function useBanIp(ip: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scope: BanScope) =>
      postJSON<BanResponse>(`/api/ip/${encodeURIComponent(ip)}/ban`, { scope }),
    onSuccess: (data, scope) =>
      // The server's ban list comes from the fail2ban log, exported once a minute: show the
      // new ban right away instead of refetching a summary that cannot know it yet.
      queryClient.setQueryData<IpSummary>(["ip-summary", ip], (old) => {
        if (!old) return old;
        if (!data.currently_banned) return { ...old, currently_banned: false };
        const ban = manualBan(scope);
        const others = (old.active_bans ?? []).filter((b) => b.jail !== ban.jail);
        return { ...old, currently_banned: true, active_bans: [ban, ...others] };
      }),
  });
}

export function useUnbanIp(ip: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJSON<BanResponse>(`/api/ip/${encodeURIComponent(ip)}/unban`),
    onSuccess: (data) =>
      // Unban lifts the IP from every jail.
      queryClient.setQueryData<IpSummary>(["ip-summary", ip], (old) =>
        old
          ? { ...old, currently_banned: data.currently_banned, active_bans: data.currently_banned ? old.active_bans : [] }
          : old
      ),
  });
}
