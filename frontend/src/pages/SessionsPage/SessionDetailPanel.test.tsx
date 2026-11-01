import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import { SessionDetailPanel, relativeTime } from "./SessionDetailPanel";

vi.mock("../../components/ReplayPlayer", () => ({
  ReplayPlayer: ({ sessionId }: { sessionId: string }) => <div>replay {sessionId}</div>,
}));

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const DETAIL = {
  session: {
    session_id: "a279a5a0ccab",
    src_ip: "118.145.239.187",
    src_port: 37724,
    protocol: "ssh",
    connect_time: "2026-10-30T10:03:49Z",
    close_time: "2026-10-30T10:08:50Z",
    duration_ms: 301089,
    login_username: "root",
    login_password: "Password123.",
    login_success: 1,
  },
  commands: [
    { timestamp: "2026-10-30T10:03:51Z", input_text: "cd ~; chattr -ia .ssh" },
    { timestamp: "2026-10-30T10:04:23Z", input_text: "cat /proc/cpuinfo | grep name | wc -l" },
  ],
  ttylogs: ["var/lib/cowrie/tty/abc"],
  ip: {
    ip: "118.145.239.187", country: "China", country_code: "CN", asn: 137718,
    asn_org: "Volcano Engine", sessions: 4, banned: false, protected: false,
  },
  campaign: { id: "fam1", sessions: 1284, sample_command: "cd ~; chattr -ia .ssh" },
};

function render(detail: unknown = DETAIL) {
  vi.stubGlobal("fetch", vi.fn(() => jsonResponse(detail)));
  return renderWithProviders(<SessionDetailPanel sessionId="a279a5a0ccab" onClose={() => {}} />, {
    route: "/sessions?session=a279a5a0ccab",
  });
}

describe("SessionDetailPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("formats command times relative to the connection", () => {
    expect(relativeTime("2026-10-30T10:03:49Z", "2026-10-30T10:04:23Z")).toBe("+00:34");
    expect(relativeTime("2026-10-30T10:00:00Z", "2026-10-30T11:01:05Z")).toBe("+1:01:05");
  });

  it("summarises the session, the IP and its campaign above the tabs", async () => {
    render();
    await screen.findByRole("heading", { name: "a279a5a0ccab" });
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "a279a5a0ccab" })).toBeInTheDocument();
    expect(within(panel).getByText("118.145.239.187:37724")).toBeInTheDocument();
    expect(within(panel).getByText(/AS137718 Volcano Engine/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /Campagne · 1 ?284 sessions/ })).toHaveAttribute(
      "href",
      "/campaigns?campaign=fam1"
    );
    expect(within(panel).getByRole("link", { name: "Page IP →" })).toHaveAttribute("href", "/ip/118.145.239.187");
    expect(within(panel).getByText("Password123.")).toBeInTheDocument();
    expect(within(panel).getByText("replay a279a5a0ccab")).toBeInTheDocument();
  });

  it("shows commands with relative times in their own tab", async () => {
    render();
    await screen.findByRole("heading", { name: "a279a5a0ccab" });
    await userEvent.click(screen.getByRole("tab", { name: /Commandes/ }));
    expect(screen.getByText("+00:34")).toBeInTheDocument();
    expect(screen.getByText("cat /proc/cpuinfo | grep name | wc -l")).toBeInTheDocument();
    expect(screen.queryByText("replay a279a5a0ccab")).toBeNull();
  });

  it("offers JSON and cast exports", async () => {
    render();
    await screen.findByRole("heading", { name: "a279a5a0ccab" });
    await userEvent.click(screen.getByRole("button", { name: /Exporter/ }));
    expect(screen.getByRole("menuitem", { name: /Session \(JSON\)/ })).toHaveAttribute(
      "href",
      "/api/sessions/a279a5a0ccab/export"
    );
    expect(screen.getByRole("menuitem", { name: /Replay \(\.cast\)/ })).toHaveAttribute(
      "href",
      "/api/sessions/a279a5a0ccab/replay?download=1"
    );
  });

  it("opens on commands and hides the cast export when there is no recording", async () => {
    render({ ...DETAIL, ttylogs: [], campaign: null });
    await screen.findByRole("heading", { name: "a279a5a0ccab" });
    expect(screen.getByRole("tab", { name: /Commandes/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: /Exporter/ }));
    expect(screen.queryByRole("menuitem", { name: /Replay/ })).toBeNull();
  });
});
