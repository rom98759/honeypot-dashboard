import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test-utils";
import { IpDetailPage } from "./IpDetailPage";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const SUMMARY = {
  ip: "1.2.3.4",
  country: "France",
  city: "Paris",
  latitude: 48.85,
  longitude: 2.35,
  first_seen: "2026-08-01T10:00:00Z",
  last_seen: "2026-08-14T09:00:00Z",
  total_sessions: 3,
  total_commands: 7,
  currently_banned: true,
};

const SESSIONS = {
  items: [
    {
      session_id: "s1",
      src_ip: "1.2.3.4",
      connect_time: "2026-08-14T09:00:00Z",
      duration_ms: 5000,
      login_username: "root",
    },
  ],
  total: 3,
};

const FAIL2BAN = {
  items: [{ action: "Ban", jail: "sshd", timestamp: "2026-08-14T08:00:00Z" }],
  total: 1,
};

const SSHD_AUTH = {
  items: [{ result: "failed_password", timestamp: "2026-08-14T07:00:00Z" }],
  total: 1,
};

function stubFetch(
  overrides: Partial<{ summary: unknown; sessions: unknown; fail2ban: unknown; sshdAuth: unknown }> = {}
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/summary")) return jsonResponse(overrides.summary ?? SUMMARY);
      if (url.includes("/fail2ban")) return jsonResponse(overrides.fail2ban ?? FAIL2BAN);
      if (url.includes("/sshd-auth")) return jsonResponse(overrides.sshdAuth ?? SSHD_AUTH);
      if (url.startsWith("/api/sessions/s1/replay")) {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url.startsWith("/api/sessions/s1")) {
        return jsonResponse({
          session: {
            session_id: "s1",
            src_ip: "1.2.3.4",
            src_port: null,
            protocol: null,
            connect_time: "2026-08-14T09:00:00Z",
            close_time: null,
            duration_ms: 5000,
            login_username: "root",
            login_password: null,
            login_success: null,
          },
          commands: [],
        });
      }
      if (url.startsWith("/api/sessions")) return jsonResponse(overrides.sessions ?? SESSIONS);
      return jsonResponse({});
    })
  );
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/ip/:ip" element={<IpDetailPage />} />
    </Routes>,
    { route: "/ip/1.2.3.4" }
  );
}

describe("IpDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the summary header with location, ban status, and stats", async () => {
    stubFetch();
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "1.2.3.4" })).toBeInTheDocument());
    expect(screen.getByText("Paris, France")).toBeInTheDocument();
    expect(screen.getByText("Banni")).toHaveClass("badge-danger");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders the sessions section and opens the detail panel on row click", async () => {
    stubFetch();
    renderPage();
    await waitFor(() => expect(screen.getByText("root")).toBeInTheDocument());

    await userEvent.click(screen.getByText("root"));
    await waitFor(() => expect(document.body.querySelector(".session-panel")).not.toBeNull());
  });

  it("renders the fail2ban history with a danger badge for Ban", async () => {
    stubFetch();
    renderPage();
    await waitFor(() => expect(screen.getByText("Ban")).toBeInTheDocument());
    expect(screen.getByText("Ban")).toHaveClass("badge-danger");
  });

  it("renders the fail2ban history with a success badge for Unban", async () => {
    stubFetch({ fail2ban: { items: [{ action: "Unban", jail: "sshd", timestamp: "t" }], total: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Unban")).toBeInTheDocument());
    expect(screen.getByText("Unban")).toHaveClass("badge-success");
  });

  it("renders the sshd-auth history with a danger badge for accepted", async () => {
    stubFetch({ sshdAuth: { items: [{ result: "accepted", timestamp: "t" }], total: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Accepté")).toBeInTheDocument());
    expect(screen.getByText("Accepté")).toHaveClass("badge-danger");
  });

  it("paginates the fail2ban section independently from the sessions section", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/summary")) return jsonResponse(SUMMARY);
      if (url.includes("/fail2ban")) {
        return jsonResponse({ items: [{ action: "Ban", jail: "sshd", timestamp: "t" }], total: 60 });
      }
      if (url.includes("/sshd-auth")) return jsonResponse(SSHD_AUTH);
      if (url.startsWith("/api/sessions")) return jsonResponse(SESSIONS);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByText("Ban")).toBeInTheDocument());

    // DOM order: sessions pagination, then fail2ban pagination, then sshd-auth pagination.
    const nextButtons = screen.getAllByRole("button", { name: "Suivant" });
    await userEvent.click(nextButtons[1]);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/fail2ban?limit=25&offset=25"))
    );
  });

  it("shows an empty state when there are no fail2ban events", async () => {
    stubFetch({ fail2ban: { items: [], total: 0 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Aucun événement fail2ban")).toBeInTheDocument());
  });

  it("shows an error state when the summary fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/summary")) return Promise.resolve({ ok: false, status: 404 } as Response);
        return jsonResponse({ items: [], total: 0 });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Erreur de chargement, réessaie.")).toBeInTheDocument());
  });

  it("shows an Unban button when banned, calls the unban endpoint, and refreshes the badge", async () => {
    let banned = true;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/summary")) {
        return jsonResponse({ ...SUMMARY, currently_banned: banned });
      }
      if (url === "/api/ip/1.2.3.4/unban" && init?.method === "POST") {
        banned = false;
        return jsonResponse({ currently_banned: false });
      }
      if (url.includes("/fail2ban")) return jsonResponse(FAIL2BAN);
      if (url.includes("/sshd-auth")) return jsonResponse(SSHD_AUTH);
      if (url.startsWith("/api/sessions")) return jsonResponse(SESSIONS);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await waitFor(() => expect(screen.getByText("Banni")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Débannir" }));

    await waitFor(() => expect(screen.getByText("Non banni")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/ip/1.2.3.4/unban", expect.objectContaining({ method: "POST" }));
  });

  it("shows a Ban button when not banned and calls the ban endpoint", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/summary")) return jsonResponse({ ...SUMMARY, currently_banned: false });
      if (url === "/api/ip/1.2.3.4/ban" && init?.method === "POST") {
        return jsonResponse({ currently_banned: true });
      }
      if (url.includes("/fail2ban")) return jsonResponse(FAIL2BAN);
      if (url.includes("/sshd-auth")) return jsonResponse(SSHD_AUTH);
      if (url.startsWith("/api/sessions")) return jsonResponse(SESSIONS);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await waitFor(() => expect(screen.getByText("Non banni")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Bannir" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/ip/1.2.3.4/ban", expect.objectContaining({ method: "POST" }))
    );
  });

  it("shows an inline error if the ban action fails", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/summary")) return jsonResponse({ ...SUMMARY, currently_banned: false });
      if (url === "/api/ip/1.2.3.4/ban" && init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 503 } as Response);
      }
      if (url.includes("/fail2ban")) return jsonResponse(FAIL2BAN);
      if (url.includes("/sshd-auth")) return jsonResponse(SSHD_AUTH);
      if (url.startsWith("/api/sessions")) return jsonResponse(SESSIONS);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await waitFor(() => expect(screen.getByText("Non banni")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Bannir" }));

    await waitFor(() => expect(screen.getByText("Échec de l'action, réessaie.")).toBeInTheDocument());
  });
});
