import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchJSON, ApiError } from "./client";

describe("fetchJSON", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) }) as Response)
    );
    const data = await fetchJSON<{ a: number }>("/api/overview");
    expect(data).toEqual({ a: 1 });
  });

  it("throws an ApiError with the status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as Response)
    );
    await expect(fetchJSON("/api/sessions/missing")).rejects.toThrow(ApiError);
    await expect(fetchJSON("/api/sessions/missing")).rejects.toMatchObject({ status: 404 });
  });
});
