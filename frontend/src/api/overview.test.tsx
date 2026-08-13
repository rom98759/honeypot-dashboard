import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useOverview } from "./overview";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useOverview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /api/overview", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            total_connections: 5,
            unique_ips: 2,
            login_attempts: 1,
            currently_banned: 0,
            top_ips: [],
            top_countries: [],
            timeline: [],
          }),
        }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOverview(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/overview");
    expect(result.current.data?.total_connections).toBe(5);
  });
});
