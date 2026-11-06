import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useSessions, PAGE_SIZE } from "./sessions";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useSessions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the query string with limit/offset/sort/order and omits ip when empty", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(
      () => useSessions({ ip: "", sort: "connect_time", order: "desc", page: 1 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/sessions?limit=${PAGE_SIZE}&offset=0&sort=connect_time&order=desc`
    );
  });

  it("includes ip and the correct offset for page 2 when set", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(
      () => useSessions({ ip: "1.2.3.4", sort: "src_ip", order: "asc", page: 2 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/sessions?limit=${PAGE_SIZE}&offset=${PAGE_SIZE}&sort=src_ip&order=asc&ip=1.2.3.4`
    );
  });

  it("includes command when set, alongside ip", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(
      () =>
        useSessions({
          ip: "1.2.3.4",
          command: "whoami",
          sort: "connect_time",
          order: "desc",
          page: 1,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/sessions?limit=${PAGE_SIZE}&offset=0&sort=connect_time&order=desc&ip=1.2.3.4&command=whoami`
    );
  });

  it("includes the search filter, period, and date range in the query string when set", async () => {
    const fetchMock = vi.fn(
      async (_url: string) => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(
      () =>
        useSessions({
          ip: "",
          sort: "connect_time",
          order: "desc",
          page: 1,
          filter: "proto:ssh country:FR",
          period: "7d",
          dateFrom: "2026-08-12T10",
          dateTo: "2026-08-12T13",
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("filter=proto%3Assh+country%3AFR");
    expect(url).toContain("period=7d");
    expect(url).toContain("date_from=2026-08-12T10");
    expect(url).toContain("date_to=2026-08-12T13");
  });

  it("omits the filter, period, and date range from the query string when unset", async () => {
    const fetchMock = vi.fn(
      async (_url: string) => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(
      () => useSessions({ ip: "", sort: "connect_time", order: "desc", page: 1 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("filter=");
    expect(url).not.toContain("period=");
    expect(url).not.toContain("date_from=");
    expect(url).not.toContain("date_to=");
  });
});
