import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import { CampaignsPage } from "./CampaignsPage";
import type { CampaignDetail, CampaignList } from "../../api/types";

vi.mock("../../components/ReplayPlayer", () => ({
  ReplayPlayer: ({ sessionId }: { sessionId: string }) => <div>replay {sessionId}</div>,
}));

const ID = "a".repeat(64);

const LIST: CampaignList = {
  items: [
    {
      id: ID,
      sessions: 247599,
      ips: 209,
      share: 0.749,
      first_seen: "2026-08-13T00:00:00Z",
      last_seen: "2026-10-31T17:00:00Z",
      sample_session_id: "s2",
      sample_command: "uname -s -v -n -r -m",
      activity: Array(30).fill(10),
    },
  ],
  total: 1,
  totals: {
    campaigns: 215,
    sessions: 330651,
    new_7d: 108,
    unique_sessions: 960,
    top_share: 0.749,
    login_only: { sessions: 40520, ips: 9933 },
  },
};

const DETAIL: CampaignDetail = {
  id: ID,
  sessions: 247599,
  ips: 209,
  first_seen: "2026-08-13T00:00:00Z",
  last_seen: "2026-10-31T17:00:00Z",
  sample_session_id: "s2",
  top_asn: { asn: 198364, asn_org: "Banatsync Srl", share: 0.81 },
  top_prefix: { prefix: "109.160.32.0/24", share: 0.76 },
  top_ips: [{ ip: "109.160.32.14", sessions: 5000 }],
  commands: [{ timestamp: "2026-10-31T17:00:01Z", input_text: "uname -s -v -n -r -m" }],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url.startsWith(`/api/campaigns/${ID}`) ? DETAIL : LIST;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("CampaignsPage", () => {
  it("shows totals, campaign rows and the two pseudo rows", async () => {
    renderWithProviders(<CampaignsPage />, { route: "/campaigns" });

    expect(await screen.findByText("uname -s -v -n -r -m")).toBeInTheDocument();
    expect(screen.getByText("215")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Sessions uniques")).toBeInTheDocument();
    expect(screen.getByText("Login seul (pas de shell)")).toBeInTheDocument();
  });

  it("requests another sort when a tab is clicked", async () => {
    renderWithProviders(<CampaignsPage />, { route: "/campaigns" });
    await screen.findByText("uname -s -v -n -r -m");

    await userEvent.click(screen.getByRole("tab", { name: "Par IP" }));

    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("sort=ips"));
  });

  it("opens the campaign panel with dominant ASN, prefix and sample replay", async () => {
    renderWithProviders(<CampaignsPage />, { route: "/campaigns" });
    await userEvent.click(await screen.findByRole("link", { name: /uname -s -v -n -r -m/ }));

    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText(/Banatsync Srl/)).toBeInTheDocument();
    expect(within(panel).getByText(/109\.160\.32\.0\/24/)).toBeInTheDocument();
    expect(within(panel).getByText("replay s2")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "109.160.32.14" })).toHaveAttribute("href", "/ip/109.160.32.14");
  });
});
