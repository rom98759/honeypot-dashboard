import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useIpSummary, useIpFail2ban, useIpSshdAuth, useBanIp, useUnbanIp, IP_PAGE_SIZE } from "./ip";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(queryClient: QueryClient) {
  return function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = makeQueryClient();
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

  it("polls every 5s while enrichment_status is pending, stops once done", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount += 1;
      const status = callCount >= 2 ? "done" : "pending";
      return jsonResponse({ ip: "1.2.3.4", enrichment_status: status });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useIpSummary("1.2.3.4"), { wrapper });

    // vi.waitFor's internal polling uses real timers in some Vitest versions and can hang
    // under vi.useFakeTimers(); flush microtasks manually instead.
    for (let i = 0; i < 50 && !result.current.isSuccess; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(result.current.isSuccess).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // still pending after call 1 -> refetches

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // call 2 returned "done" -> no further polling

    vi.useRealTimers();
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

describe("useBanIp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the ban endpoint and writes the fresh status into the ip-summary cache without refetching", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/ip/1.2.3.4/ban" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ currently_banned: true }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = makeQueryClient();
    queryClient.setQueryData(["ip-summary", "1.2.3.4"], { ip: "1.2.3.4", currently_banned: false });

    const { result } = renderHook(() => useBanIp("1.2.3.4"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/ip/1.2.3.4/ban", { method: "POST" });
    // No second request to /summary — the cache is updated directly from the mutation's response.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["ip-summary", "1.2.3.4"])).toEqual({
      ip: "1.2.3.4",
      currently_banned: true,
    });
  });
});

describe("useUnbanIp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the unban endpoint and writes the fresh status into the ip-summary cache without refetching", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/ip/1.2.3.4/unban" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ currently_banned: false }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = makeQueryClient();
    queryClient.setQueryData(["ip-summary", "1.2.3.4"], { ip: "1.2.3.4", currently_banned: true });

    const { result } = renderHook(() => useUnbanIp("1.2.3.4"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/ip/1.2.3.4/unban", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["ip-summary", "1.2.3.4"])).toEqual({
      ip: "1.2.3.4",
      currently_banned: false,
    });
  });
});
