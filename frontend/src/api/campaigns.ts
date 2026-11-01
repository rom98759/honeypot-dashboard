import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { CampaignDetail, CampaignList, CampaignSort } from "./types";

export const CAMPAIGNS_PAGE_SIZE = 25;

export function useCampaigns({ sort, page }: { sort: CampaignSort; page: number }) {
  return useQuery({
    queryKey: ["campaigns", { sort, page }],
    queryFn: () => {
      const query = new URLSearchParams({
        sort,
        limit: String(CAMPAIGNS_PAGE_SIZE),
        offset: String((page - 1) * CAMPAIGNS_PAGE_SIZE),
      });
      return fetchJSON<CampaignList>(`/api/campaigns?${query.toString()}`);
    },
    // The server caches the aggregate for 5 min; refetching sooner returns the same body.
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCampaignDetail(id: string) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: () => fetchJSON<CampaignDetail>(`/api/campaigns/${encodeURIComponent(id)}`),
    staleTime: 5 * 60_000,
  });
}
