import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../test-utils";
import { OverviewPage } from "./OverviewPage";

vi.mock("../components/TimelineChart", () => ({
  TimelineChart: ({ timeline }: { timeline: { bucket: string; n: number }[] }) => (
    <div data-testid="timeline-chart-stub">{timeline.length}</div>
  ),
}));

vi.mock("../components/ProtocolDonut", () => ({
  ProtocolDonut: ({ protocolSplit }: { protocolSplit: { protocol: string; n: number }[] }) => (
    <div data-testid="protocol-donut-stub">{protocolSplit.length}</div>
  ),
}));

vi.mock("../components/BansBarChart", () => ({
  BansBarChart: ({ bansTimeline }: { bansTimeline: { bucket: string; n: number }[] }) => (
    <div data-testid="bans-bar-chart-stub">{bansTimeline.length}</div>
  ),
}));

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const FULL_OVERVIEW = {
  total_connections: 12,
  unique_ips: 4,
  login_attempts: 3,
  currently_banned: 1,
  top_ips: [{ src_ip: "1.2.3.4", n: 6 }],
  top_countries: [{ country: "France", n: 6 }],
  timeline: [{ bucket: "2026-08-13T10", n: 6 }],
  protocol_split: [
    { protocol: "ssh", n: 10 },
    { protocol: "telnet", n: 2 },
  ],
  top_credentials: [{ login_username: "root", login_password: "123456", n: 5 }],
  bans_timeline: [{ bucket: "2026-08-13T10", n: 2 }],
};

describe("OverviewPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a skeleton before data resolves, then the stat cards", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)))
    );
    const { container } = renderWithProviders(<OverviewPage />);
    expect(container.querySelector(".skeleton-block")).not.toBeNull();

    resolveFetch({ ok: true, json: async () => FULL_OVERVIEW } as Response);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(container.querySelector(".skeleton-block")).toBeNull();
  });

  it("fetches with the default 24h period and switches period on click", async () => {
    const fetchMock = vi.fn(() => jsonResponse(FULL_OVERVIEW));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=24h");

    await userEvent.click(screen.getByRole("button", { name: "30j" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/overview?period=30d"));
  });

  it("renders the protocol donut, bans chart, and top credentials table", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(FULL_OVERVIEW)));
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId("protocol-donut-stub")).toBeInTheDocument());
    expect(screen.getByTestId("bans-bar-chart-stub")).toBeInTheDocument();
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();
  });

  it("shows (vide) for a null attempted password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          ...FULL_OVERVIEW,
          top_credentials: [{ login_username: "admin", login_password: null, n: 2 }],
        })
      )
    );
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("(vide)")).toBeInTheDocument());
  });

  it("links the Top IP row to its IP detail page", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(FULL_OVERVIEW)));
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "1.2.3.4" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "1.2.3.4" })).toHaveAttribute("href", "/ip/1.2.3.4");
  });

  it("renders empty states and skips charts when there is no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          ...FULL_OVERVIEW,
          top_countries: [],
          top_ips: [],
          protocol_split: [],
          bans_timeline: [],
          top_credentials: [],
        })
      )
    );
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getAllByText("Aucune donnée")).toHaveLength(5));
    expect(screen.getByTestId("timeline-chart-stub")).toBeInTheDocument();
  });

  it("shows an error state and recovers via the retry button", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("Erreur de chargement, réessaie.")).toBeInTheDocument());

    fetchMock.mockImplementationOnce(() => jsonResponse(FULL_OVERVIEW));
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
  });

  it("auto-refreshes every 10s without flashing the skeleton again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => jsonResponse(FULL_OVERVIEW));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".skeleton-block")).toBeNull();
  });
});
