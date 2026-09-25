import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { PaginatedSessions, SessionDetail } from "./types";

export const PAGE_SIZE = 25;

export interface SessionsQuery {
  ip: string;
  command?: string;
  protocol?: string;
  country?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: string;
  order: "asc" | "desc";
  page: number;
}

export function useSessions({
  ip,
  command,
  protocol,
  country,
  period,
  dateFrom,
  dateTo,
  sort,
  order,
  page,
}: SessionsQuery) {
  const offset = (page - 1) * PAGE_SIZE;
  return useQuery({
    queryKey: ["sessions", { ip, command, protocol, country, period, dateFrom, dateTo, sort, order, page }],
    queryFn: () => {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        order,
      });
      if (ip) query.set("ip", ip);
      if (command) query.set("command", command);
      if (protocol) query.set("protocol", protocol);
      if (country) query.set("country", country);
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
