import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useOverview, useOverviewHeatmap } from "./overview";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const EMPTY_OVERVIEW = {
  total_connections: 5,
  unique_ips: 2,
  login_attempts: 1,
  currently_banned: 0,
  top_offenders: [],
  top_countries: [],
  timeline: [],
  protocol_split: [],
  top_credentials: [],
  bans_timeline: [],
  duration_distribution: [],
};

describe("useOverview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /api/overview with the default 24h period", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => EMPTY_OVERVIEW }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOverview(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=24h");
    expect(result.current.data?.total_connections).toBe(5);
  });

  it("fetches with an explicit period", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => EMPTY_OVERVIEW }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOverview("30d"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=30d");
  });
});

describe("useOverviewHeatmap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /api/overview/heatmap with no query params", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ cells: [{ day_of_week: 0, hour: 3, n: 2 }] }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOverviewHeatmap(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/overview/heatmap");
    expect(result.current.data?.cells).toEqual([{ day_of_week: 0, hour: 3, n: 2 }]);
  });
});
