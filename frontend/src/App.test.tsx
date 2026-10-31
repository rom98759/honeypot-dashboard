import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders } from "./test-utils";
import App from "./App";

vi.mock("./components/ActivityChart", () => ({ ActivityChart: () => <div>activity chart</div> }));
vi.mock("./components/WorldMap", () => ({ WorldMap: () => <div>world map</div> }));

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.startsWith("/api/overview/heatmap")) {
        return jsonResponse({ cells: [] });
      }
      if (url.startsWith("/api/overview")) {
        return jsonResponse({
          total_connections: 0,
          unique_ips: 0,
          login_attempts: 0,
          avg_duration_ms: null,
          previous: null,
          active_sessions: 0,
          currently_banned: 0,
          top_offenders: [],
          top_countries: [],
          countries: [],
          timeline: [],
          protocol_split: [],
          top_credentials: [],
          top_usernames: [],
          top_passwords: [],
          top_commands: [],
          bans_timeline: [],
          duration_distribution: [],
        });
      }
      if (url.includes("/summary")) {
        return jsonResponse({
          ip: "1.2.3.4",
          country: null,
          city: null,
          latitude: null,
          longitude: null,
          first_seen: null,
          last_seen: null,
          total_sessions: 0,
          total_commands: 0,
          currently_banned: false,
        });
      }
      if (url.includes("/fail2ban")) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.includes("/sshd-auth")) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.startsWith("/api/sessions")) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.startsWith("/api/correlation")) {
        return jsonResponse([]);
      }
      return jsonResponse({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("redirects the default route to Overview", async () => {
    renderWithProviders(<App />, { route: "/" });
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Vue d'ensemble").closest("a")).toHaveClass("active"));
  });

  it("renders the Sessions page when navigating there", async () => {
    renderWithProviders(<App />, { route: "/sessions" });
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Sessions").closest("a")).toHaveClass("active"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument()
    );
  });

  it("renders the Correlation page when navigating there", async () => {
    renderWithProviders(<App />, { route: "/correlation" });
    const nav = screen.getByRole("navigation");
    await waitFor(() =>
      expect(within(nav).getByText("Corrélation").closest("a")).toHaveClass("active")
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Corrélation" })).toBeInTheDocument()
    );
  });

  it("renders the Map page when navigating there", async () => {
    renderWithProviders(<App />, { route: "/map" });
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Carte").closest("a")).toHaveClass("active"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Carte" })).toBeInTheDocument());
  });

  it("renders the IP detail page when navigating there", async () => {
    renderWithProviders(<App />, { route: "/ip/1.2.3.4" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "1.2.3.4" })).toBeInTheDocument());
  });
});
