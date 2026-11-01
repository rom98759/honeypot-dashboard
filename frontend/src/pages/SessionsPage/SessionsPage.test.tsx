import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { Link, Routes, Route } from "react-router-dom";
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

  it("shows protocol, password and a badge for successful logins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          items: [
            {
              ...SESSIONS_PAGE_1.items[0],
              protocol: "telnet",
              login_password: "123456",
              login_success: 1,
            },
          ],
          total: 1,
        })
      )
    );
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    expect(await screen.findByText("TELNET")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();
    // Cowrie accepts logins on purpose: an accepted login is the decoy working, not a breach.
    const accepted = screen.getByText("Accepté");
    expect(accepted).toHaveClass("badge-neutral");
    expect(accepted).toHaveAttribute("title", expect.stringContaining("leurre"));
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

  it("resets to page 1 when the IP filter changes while on a later page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn((_url: string) => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions?page=3" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("offset=50"));

    const input = screen.getByPlaceholderText("Filtrer par IP...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9.9.9.9" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("ip=9.9.9.9"))
    );
    const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(lastUrl).toContain("offset=0");
    expect(lastUrl).not.toContain("offset=50");
  });

  it("cancels a pending debounced filter update when a sort click happens before it fires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn((_url: string) => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Filtrer par IP...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9.9.9.9" } });

    // Advance partway through the 300ms debounce window, then navigate away
    // from the pending filter update by clicking a sort header.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.click(screen.getByRole("button", { name: /IP/ }));

    // Advance past the original debounce deadline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("sort=src_ip&order=asc"))
    );
    const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(lastUrl).not.toContain("ip=9.9.9.9");
  });

  it("opens the detail panel with the session id when a row is clicked, and Escape closes it", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sessions/s1/replay")) {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url.startsWith("/api/sessions/s1")) {
        return jsonResponse({
          session: {
            session_id: "s1",
            src_ip: "1.2.3.4",
            src_port: 4444,
            protocol: "ssh",
            connect_time: "2026-08-13T10:00:00",
            close_time: "2026-08-13T10:05:00",
            duration_ms: 5000,
            login_username: "root",
            login_password: "toor",
            login_success: 0,
          },
          commands: [],
          ttylogs: ["var/lib/cowrie/tty/abc"],
          ip: { ip: "1.2.3.4", country: null, country_code: null, asn: null, asn_org: null, sessions: 1, banned: false, protected: false },
          campaign: null,
        });
      }
      return jsonResponse(SESSIONS_PAGE_1);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    await userEvent.click(screen.getByText("root"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "s1" })).toBeInTheDocument());
    expect(document.body.querySelector(".session-panel")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.body.querySelector(".session-panel")).toBeNull());
  });

  it("closes the panel when the backdrop is clicked", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sessions/s1/replay")) {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url.startsWith("/api/sessions/s1")) {
        return jsonResponse({
          session: { session_id: "s1", src_ip: "1.2.3.4", connect_time: "t", login_username: null },
          commands: [],
          ttylogs: ["var/lib/cowrie/tty/abc"],
          ip: { ip: "1.2.3.4", country: null, country_code: null, asn: null, asn_org: null, sessions: 1, banned: false, protected: false },
          campaign: null,
        });
      }
      return jsonResponse(SESSIONS_PAGE_1);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    await userEvent.click(screen.getByText("root"));
    await waitFor(() => expect(document.body.querySelector(".session-panel")).not.toBeNull());

    const backdrop = document.body.querySelector(".panel-backdrop") as HTMLElement;
    await userEvent.click(backdrop);
    await waitFor(() => expect(document.body.querySelector(".session-panel")).toBeNull());
  });

  it("unmounts the panel cleanly when navigating away from Sessions", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sessions/s1/replay")) {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url.startsWith("/api/sessions/s1")) {
        return jsonResponse({
          session: { session_id: "s1", src_ip: "1.2.3.4", connect_time: "t", login_username: null },
          commands: [],
          ttylogs: ["var/lib/cowrie/tty/abc"],
          ip: { ip: "1.2.3.4", country: null, country_code: null, asn: null, asn_org: null, sessions: 1, banned: false, protected: false },
          campaign: null,
        });
      }
      return jsonResponse(SESSIONS_PAGE_1);
    });
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      return (
        <div>
          <Link to="/overview">Go overview</Link>
          <Routes>
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/overview" element={<div>Overview stub</div>} />
          </Routes>
        </div>
      );
    }

    renderWithProviders(<Harness />, { route: "/sessions?session=s1" });
    await waitFor(() => expect(document.body.querySelector(".session-panel")).not.toBeNull());

    await userEvent.click(screen.getByText("Go overview"));
    await waitFor(() => expect(screen.getByText("Overview stub")).toBeInTheDocument());
    expect(document.body.querySelector(".session-panel")).toBeNull();
  });

  it("the IP link navigates to the IP detail page without opening the session panel", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(SESSIONS_PAGE_1)));

    function Harness() {
      return (
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/ip/:ip" element={<div>IP detail stub</div>} />
        </Routes>
      );
    }

    renderWithProviders(<Harness />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("link", { name: "1.2.3.4" }));
    await waitFor(() => expect(screen.getByText("IP detail stub")).toBeInTheDocument());
    expect(document.body.querySelector(".session-panel")).toBeNull();
  });

  it("shows a command-filter chip when ?command= is set, with a way to clear it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(SESSIONS_PAGE_1)));
    renderWithProviders(<SessionsPage />, { route: "/sessions?command=whoami" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(screen.getByText(/Commande : whoami/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Effacer : Commande : whoami/ }));
    await waitFor(() => expect(screen.queryByText(/Commande : whoami/)).not.toBeInTheDocument());
  });

  it("passes the command param through to the sessions request", async () => {
    const fetchMock = vi.fn(() => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions?command=whoami" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("command=whoami"));
  });

  it("does not show a command-filter chip when ?command= is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(SESSIONS_PAGE_1)));
    renderWithProviders(<SessionsPage />, { route: "/sessions" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(screen.queryByText(/Commande :/)).not.toBeInTheDocument();
  });

  it("keeps the command filter in the URL after an in-page interaction (pagination)", async () => {
    const fetchMock = vi.fn(() => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, { route: "/sessions?command=whoami" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("command=whoami"));

    await userEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("offset=25"))
    );
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("command=whoami"));
  });

  it("passes protocol, country, period, and date range params through to the sessions request", async () => {
    const fetchMock = vi.fn((_url: string) => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, {
      route: "/sessions?protocol=ssh&country=France&period=7d&date_from=2026-08-12T10&date_to=2026-08-12T13",
    });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    const url = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(url).toContain("protocol=ssh");
    expect(url).toContain("country=France");
    expect(url).toContain("period=7d");
    expect(url).toContain("date_from=2026-08-12T10");
    expect(url).toContain("date_to=2026-08-12T13");
  });

  it("shows a filter chip for each active URL filter and clears only the one whose button is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(SESSIONS_PAGE_1)));
    renderWithProviders(<SessionsPage />, { route: "/sessions?protocol=ssh&country=France" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(screen.getByText(/Protocole : ssh/)).toBeInTheDocument();
    expect(screen.getByText(/Pays : France/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Effacer : Protocole : ssh/ }));
    await waitFor(() => expect(screen.queryByText(/Protocole : ssh/)).not.toBeInTheDocument());
    expect(screen.getByText(/Pays : France/)).toBeInTheDocument();
  });

  it("keeps every active filter in the URL after an in-page interaction (pagination) with several set at once", async () => {
    const fetchMock = vi.fn((_url: string) => jsonResponse(SESSIONS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SessionsPage />, {
      route: "/sessions?command=whoami&protocol=ssh&country=France",
    });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("offset=25")));
    const url = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(url).toContain("command=whoami");
    expect(url).toContain("protocol=ssh");
    expect(url).toContain("country=France");
  });
});
