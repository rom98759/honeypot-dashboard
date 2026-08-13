import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../../test-utils";
import { SessionsPage } from "./SessionsPage";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const SESSIONS_PAGE_1 = {
  items: [
    {
      session_id: "s1",
      src_ip: "1.2.3.4",
      connect_time: "2026-08-13T10:00:00",
      duration_ms: 5000,
      login_username: "root",
    },
    {
      session_id: "s2",
      src_ip: "5.6.7.8",
      connect_time: "2026-08-13T11:00:00",
      duration_ms: null,
      login_username: null,
    },
  ],
  total: 30,
};

describe("SessionsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders session rows from the API", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(SESSIONS_PAGE_1)));
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(screen.getByText("5.6.7.8")).toBeInTheDocument();
    expect(screen.getByText("root")).toBeInTheDocument();
  });

  it("toggles sort direction on column click and re-requests with the new order", async () => {
    const fetchMock = vi.fn(() => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /IP/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("sort=src_ip&order=asc"))
    );
  });

  it("respects pagination boundaries", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ items: [], total: 0 })));
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("debounces the IP filter without losing input focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Filtrer par IP...") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "9.9.9.9" } });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("9.9.9.9");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("ip=9.9.9.9"))
    );
    expect(document.activeElement).toBe(input);
  });
});
