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
    expect(screen.getByText("Banni")).toHaveClass("badge-danger");
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

  it('links "view sessions" to the Sessions page pre-filtered by IP', async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(ROWS)));
    renderWithProviders(<CorrelationPage />, { route: "/correlation" });
    await waitFor(() => expect(screen.getByText("1.2.3.4")).toBeInTheDocument());
    // Default sort is honeypot_sessions desc (set in CorrelationPage), so the row with the
    // higher honeypot_sessions count (5.6.7.8, 20) renders first, not ROWS[0] (1.2.3.4, 10).
    const link = screen.getAllByTitle("Voir les sessions")[0];
    expect(link).toHaveAttribute("href", "/sessions?ip=5.6.7.8");
  });
});
