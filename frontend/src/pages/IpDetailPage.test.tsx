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
  active_bans: [
    { jail: "cowrie", banned_at: "2026-08-14T08:00:00Z", expires_at: "2026-08-15T08:00:00Z", scope: "services" },
  ],
  asn: 15169,
  asn_org: "GOOGLE",
  reverse_dns: "dns.google",
  abuseipdb_score: 87,
  abuseipdb_total_reports: 12,
  abuseipdb_last_reported_at: "2026-10-01T00:00:00Z",
  abuseipdb_configured: true,
  enrichment_status: "done",
  protected: false,
  ban_enabled: true,
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
          ttylogs: ["var/lib/cowrie/tty/abc"],
          ip: { ip: "1.2.3.4", country: null, country_code: null, asn: null, asn_org: null, sessions: 1, banned: false, protected: false },
          campaign: null,
        });
      }
      if (url.startsWith("/api/sessions")) return jsonResponse(overrides.sessions ?? SESSIONS);
      if (url.endsWith("/ban")) return jsonResponse({ currently_banned: true });
      return jsonResponse({});
    })
  );
  return fetch as unknown as ReturnType<typeof vi.fn>;
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
    expect(screen.getByText("Banni")).toHaveClass("badge-success");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("asks for confirmation before banning and only posts once confirmed", async () => {
    const fetchMock = stubFetch({ summary: { ...SUMMARY, currently_banned: false, protected: false } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Bannir" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Bannir 1.2.3.4 pendant 7 jours");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/ban"), expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Bannir" }));
    await userEvent.click(screen.getByRole("button", { name: "Vrais services" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ip/1.2.3.4/ban",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ scope: "services" }) })
      )
    );
  });

  it("lists running bans with what they block and until when", async () => {
    stubFetch({});
    renderPage();
    const bans = await screen.findByRole("list", { name: "Bans en cours" });
    expect(bans).toHaveTextContent("cowrie");
    expect(bans).toHaveTextContent("pas Cowrie");
    expect(bans).toHaveTextContent("jusqu'au");
  });

  it("shows protected IPs without any ban button", async () => {
    stubFetch({ summary: { ...SUMMARY, currently_banned: false, protected: true } });
    renderPage();
    expect(await screen.findByText("Protégée")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bannir" })).toBeNull();
  });

  it("hides ban controls when ban control is disabled on the server", async () => {
    stubFetch({ summary: { ...SUMMARY, currently_banned: false, ban_enabled: false } });
    renderPage();
    expect(await screen.findByText("Non banni")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bannir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Débannir" })).toBeNull();
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

  it("renders the sshd-auth history with a warning badge for a failed attempt", async () => {
    stubFetch({ sshdAuth: { items: [{ result: "failed_password", timestamp: "t" }], total: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Mot de passe échoué")).toBeInTheDocument());
    expect(screen.getByText("Mot de passe échoué")).toHaveClass("badge-warning");
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
    await userEvent.click(screen.getByRole("button", { name: "Tout bloquer" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ip/1.2.3.4/ban",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ scope: "all" }) })
      )
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
    await userEvent.click(screen.getByRole("button", { name: "Vrais services" }));

    await waitFor(() => expect(screen.getByText("Échec de l'action, réessaie.")).toBeInTheDocument());
  });
});

describe("IP enrichment panel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a skeleton while enrichment_status is pending", async () => {
    stubFetch({ summary: { ...SUMMARY, enrichment_status: "pending", asn: null, asn_org: null, reverse_dns: null } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Enrichissement")).toBeInTheDocument());
    expect(screen.queryByText("AS15169 · GOOGLE")).not.toBeInTheDocument();
  });

  it("shows ASN and reverse DNS once done", async () => {
    stubFetch();
    renderPage();

    await waitFor(() => expect(screen.getByText("AS15169 · GOOGLE")).toBeInTheDocument());
    expect(screen.getByText("dns.google")).toBeInTheDocument();
  });

  it("shows fallback text when ASN/reverse DNS resolved to nothing", async () => {
    stubFetch({ summary: { ...SUMMARY, asn: null, asn_org: null, reverse_dns: null } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Non résolu")).toBeInTheDocument());
    expect(screen.getByText("Aucun")).toBeInTheDocument();
  });

  it("shows the AbuseIPDB badge with a danger tone for a high score", async () => {
    stubFetch();
    renderPage();

    await waitFor(() => expect(screen.getByText("Score 87/100")).toBeInTheDocument());
    expect(screen.getByText("Score 87/100")).toHaveClass("badge-danger");
    expect(screen.getByText(/12 signalement/)).toBeInTheDocument();
  });

  it("hides the AbuseIPDB section entirely when the feature is not configured", async () => {
    stubFetch({ summary: { ...SUMMARY, abuseipdb_configured: false, abuseipdb_score: null, abuseipdb_total_reports: null } });
    renderPage();

    await waitFor(() => expect(screen.getByText("AS15169 · GOOGLE")).toBeInTheDocument());
    expect(screen.queryByText(/Score/)).not.toBeInTheDocument();
  });

  it("renders a hostile-looking reverse DNS value as inert text, not markup", async () => {
    stubFetch({ summary: { ...SUMMARY, reverse_dns: "<img src=x onerror=alert(1)>" } });
    renderPage();

    await waitFor(() => expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument());
    expect(document.querySelector("img[onerror]")).toBeNull();
  });
});
