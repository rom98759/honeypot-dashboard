import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJSON, postJSON } from "./client";
import type { IpSummary, PaginatedFail2ban, PaginatedSshdAuth } from "./types";

export const IP_PAGE_SIZE = 25;

export function useIpSummary(ip: string) {
  return useQuery({
    queryKey: ["ip-summary", ip],
    queryFn: () => fetchJSON<IpSummary>(`/api/ip/${encodeURIComponent(ip)}/summary`),
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

export function useBanIp(ip: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJSON<BanResponse>(`/api/ip/${encodeURIComponent(ip)}/ban`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ip-summary", ip] }),
  });
}

export function useUnbanIp(ip: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJSON<BanResponse>(`/api/ip/${encodeURIComponent(ip)}/unban`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ip-summary", ip] }),
  });
}
