import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { PaginatedCommands } from "./types";
import type { Period } from "../theme/PeriodContext";

export const COMMANDS_PAGE_SIZE = 25;

export function useCommands({ period, q, page }: { period: Period; q: string; page: number }) {
  const offset = (page - 1) * COMMANDS_PAGE_SIZE;
  return useQuery({
    queryKey: ["commands", { period, q, page }],
    queryFn: () => {
      const query = new URLSearchParams({
        period,
        limit: String(COMMANDS_PAGE_SIZE),
        offset: String(offset),
      });
      if (q) query.set("q", q);
      return fetchJSON<PaginatedCommands>(`/api/commands?${query.toString()}`);
    },
    placeholderData: keepPreviousData,
  });
}
