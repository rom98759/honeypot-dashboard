import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useIpSummary, useIpFail2ban, useIpSshdAuth, IP_PAGE_SIZE } from "./ip";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe("useIpSummary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /api/ip/{ip}/summary with the ip URL-encoded", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ ip: "1.2.3.4" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useIpSummary("1.2.3.4"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/ip/1.2.3.4/summary");
  });
});

describe("useIpFail2ban", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches with limit/offset computed from the page", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ items: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useIpFail2ban("1.2.3.4", 2), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/ip/1.2.3.4/fail2ban?limit=${IP_PAGE_SIZE}&offset=${IP_PAGE_SIZE}`
    );
  });
});

describe("useIpSshdAuth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches with limit/offset computed from the page", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ items: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useIpSshdAuth("1.2.3.4", 1), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(`/api/ip/1.2.3.4/sshd-auth?limit=${IP_PAGE_SIZE}&offset=0`);
  });
});
