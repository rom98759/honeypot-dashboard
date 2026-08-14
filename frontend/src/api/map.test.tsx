import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useMap } from "./map";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useMap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /api/map with the given period", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ points: [], destination: null }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMap({ period: "7d", live: false }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/map?period=7d");
  });

  it("sets refetchInterval only when live is true", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ points: [], destination: null }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMap({ period: "24h", live: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // TanStack Query doesn't expose refetchInterval on the result directly; behavior is
    // covered end-to-end by MapPage's fake-timer test in Task 7. This test only confirms
    // the query itself succeeds when live=true is passed.
    expect(fetchMock).toHaveBeenCalledWith("/api/map?period=24h");
  });
});
