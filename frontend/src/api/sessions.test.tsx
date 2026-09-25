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
});
