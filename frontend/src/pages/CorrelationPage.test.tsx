import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../test-utils";
import { CorrelationPage } from "./CorrelationPage";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const ROWS = [
  { ip: "1.2.3.4", honeypot_sessions: 10, fail2ban_banned: true, real_ssh_attempts: 3 },
  { ip: "5.6.7.8", honeypot_sessions: 20, fail2ban_banned: false, real_ssh_attempts: 0 },
];

describe("CorrelationPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a row per IP with the correct badge tones", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(ROWS)));
    renderWithProviders(<CorrelationPage />, { route: "/correlation" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(screen.getByText("Banni")).toHaveClass("badge-success");
    expect(screen.getByText("Non banni")).toHaveClass("badge-neutral");
    expect(screen.getByText("3 tentatives")).toHaveClass("badge-warning");
    expect(screen.getByText("Aucune")).toHaveClass("badge-neutral");
  });

  it("sorts rows client-side when a column header is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(ROWS)));
    renderWithProviders(<CorrelationPage />, { route: "/correlation" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^IP/ }));
    const cells = screen.getAllByRole("cell").filter((c) => c.className === "mono");
    expect(cells[0]).toHaveTextContent("1.2.3.4");
  });

  it('links "view detail" to the IP detail page', async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(ROWS)));
    renderWithProviders(<CorrelationPage />, { route: "/correlation" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    // Default sort is honeypot_sessions desc (set in CorrelationPage), so the row with the
    // higher honeypot_sessions count (5.6.7.8, 20) renders first, not ROWS[0] (1.2.3.4, 10).
    const link = screen.getAllByTitle("Voir le détail")[0];
    expect(link).toHaveAttribute("href", "/ip/5.6.7.8");
  });

  function routedFetch(config: unknown) {
    return vi.fn((url: string) => jsonResponse(url === "/api/config" ? config : ROWS));
  }

  it("labels the real sshd column with the configured port", async () => {
    vi.stubGlobal("fetch", routedFetch({ sshd_port: 50022, ban_enabled: false }));
    renderWithProviders(<CorrelationPage />, { route: "/correlation" });
    expect(await screen.findByRole("button", { name: /Tentatives sshd \(port 50022\)/ })).toBeInTheDocument();
  });

  it("falls back to a generic label when no port is configured", async () => {
    vi.stubGlobal("fetch", routedFetch({ sshd_port: null, ban_enabled: false }));
    renderWithProviders(<CorrelationPage />, { route: "/correlation" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Tentatives sshd réel/ })).toBeInTheDocument();
    expect(screen.queryByText(/Tentatives port/)).toBeNull();
  });
});
