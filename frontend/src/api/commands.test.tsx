import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useCommands, COMMANDS_PAGE_SIZE } from "./commands";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useCommands", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the query string with period/limit/offset and omits q when empty", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCommands({ period: "24h", q: "", page: 1 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/commands?period=24h&limit=${COMMANDS_PAGE_SIZE}&offset=0`
    );
  });

  it("includes q and the correct offset for page 2 when set", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCommands({ period: "7d", q: "wget", page: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/commands?period=7d&limit=${COMMANDS_PAGE_SIZE}&offset=${COMMANDS_PAGE_SIZE}&q=wget`
    );
  });
});
