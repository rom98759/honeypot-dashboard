import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { PaginatedSessions, SessionDetail } from "./types";

export const PAGE_SIZE = 25;

export interface SessionsQuery {
  ip?: string;
  /** Search language, see utils/searchFilter.ts. */
  filter?: string;
  command?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: string;
  order: "asc" | "desc";
  page: number;
}

export function useSessions({
  ip,
  filter,
  command,
  period,
  dateFrom,
  dateTo,
  sort,
  order,
  page,
}: SessionsQuery) {
  const offset = (page - 1) * PAGE_SIZE;
  return useQuery({
    queryKey: ["sessions", { ip, filter, command, period, dateFrom, dateTo, sort, order, page }],
    queryFn: () => {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        order,
      });
      if (ip) query.set("ip", ip);
      if (filter) query.set("filter", filter);
      if (command) query.set("command", command);
      if (period) query.set("period", period);
      if (dateFrom) query.set("date_from", dateFrom);
      if (dateTo) query.set("date_to", dateTo);
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
