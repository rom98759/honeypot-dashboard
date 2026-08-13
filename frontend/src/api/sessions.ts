import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { PaginatedSessions, SessionDetail } from "./types";

export const PAGE_SIZE = 25;

export interface SessionsQuery {
  ip: string;
  sort: string;
  order: "asc" | "desc";
  page: number;
}

export function useSessions({ ip, sort, order, page }: SessionsQuery) {
  const offset = (page - 1) * PAGE_SIZE;
  return useQuery({
    queryKey: ["sessions", { ip, sort, order, page }],
    queryFn: () => {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        order,
      });
      if (ip) query.set("ip", ip);
      return fetchJSON<PaginatedSessions>(`/api/sessions?${query.toString()}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function useSessionDetail(sessionId: string) {
  return useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchJSON<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`),
  });
}
