import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test-utils";
import { PeriodProvider } from "../theme/PeriodContext";
import { OverviewPage } from "./OverviewPage";

vi.mock("../components/TimelineChart", () => ({
  TimelineChart: ({
    timeline,
    onRangeChange,
  }: {
    timeline: { bucket: string; n: number }[];
    onRangeChange?: (range: { start: string; end: string } | null) => void;
  }) => (
    <div data-testid="timeline-chart-stub">
      {timeline.length}
      <button onClick={() => onRangeChange?.({ start: "2026-08-13T10", end: "2026-08-13T11" })}>
        Simulate zoom
      </button>
      <button onClick={() => onRangeChange?.(null)}>Simulate reset</button>
    </div>
  ),
}));

vi.mock("../components/ProtocolDonut", () => ({
  ProtocolDonut: ({
    protocolSplit,
    onSliceClick,
  }: {
    protocolSplit: { protocol: string; n: number }[];
    onSliceClick?: (protocol: string) => void;
  }) => (
    <div data-testid="protocol-donut-stub">
      {protocolSplit.length}
      <button onClick={() => onSliceClick?.("ssh")}>Simulate protocol click</button>
    </div>
  ),
}));

vi.mock("../components/BansBarChart", () => ({
  BansBarChart: ({
    bansTimeline,
    onBarClick,
  }: {
    bansTimeline: { bucket: string; n: number }[];
    onBarClick?: (bucket: string) => void;
  }) => (
    <div data-testid="bans-bar-chart-stub">
      {bansTimeline.length}
      <button onClick={() => onBarClick?.("2026-08-13")}>Simulate bar click</button>
    </div>
  ),
}));

vi.mock("../components/AttackHeatmap", () => ({
  AttackHeatmap: ({ cells }: { cells: { n: number }[] }) => (
    <div data-testid="attack-heatmap-stub">{cells.length}</div>
  ),
}));

vi.mock("../components/DurationDistributionChart", () => ({
  DurationDistributionChart: ({ distribution }: { distribution: { n: number }[] }) => (
    <div data-testid="duration-chart-stub">{distribution.length}</div>
  ),
}));

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const EMPTY_HEATMAP = { cells: [] };

function stubOverviewFetch(overviewBody: unknown, heatmapBody: unknown = EMPTY_HEATMAP) {
  return vi.fn((url: string) =>
    url.includes("/heatmap") ? jsonResponse(heatmapBody) : jsonResponse(overviewBody)
  );
}

const FULL_OVERVIEW = {
  total_connections: 12,
  unique_ips: 4,
  login_attempts: 3,
  currently_banned: 1,
  top_offenders: [{ src_ip: "1.2.3.4", n: 6, country: "France", last_seen: "2026-08-13T10:00:00Z" }],
  duration_distribution: [
    { bucket: "<10s", n: 1 },
    { bucket: "10-60s", n: 2 },
    { bucket: "1-5min", n: 3 },
    { bucket: "5-30min", n: 4 },
    { bucket: ">30min", n: 5 },
  ],
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
      vi.fn((url: string) =>
        url.includes("/heatmap")
          ? Promise.resolve({ ok: true, json: async () => EMPTY_HEATMAP } as Response)
          : new Promise<Response>((resolve) => (resolveFetch = resolve))
      )
    );
    const { container } = renderWithProviders(<OverviewPage />);
    expect(container.querySelector(".skeleton-block")).not.toBeNull();

    resolveFetch({ ok: true, json: async () => FULL_OVERVIEW } as Response);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(container.querySelector(".skeleton-block")).toBeNull();
  });

  it("fetches with the default 24h period and switches period on click", async () => {
    const fetchMock = stubOverviewFetch(FULL_OVERVIEW);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=24h");

    await userEvent.click(screen.getByRole("button", { name: "30j" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/overview?period=30d"));
  });

  it("renders the protocol donut, bans chart, and top credentials table", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId("protocol-donut-stub")).toBeInTheDocument());
    expect(screen.getByTestId("bans-bar-chart-stub")).toBeInTheDocument();
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();
  });

  it("shows (vide) for a null attempted password", async () => {
    vi.stubGlobal(
      "fetch",
      stubOverviewFetch({
        ...FULL_OVERVIEW,
        top_credentials: [{ login_username: "admin", login_password: null, n: 2 }],
      })
    );
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("(vide)")).toBeInTheDocument());
  });

  it("links the offender row to its IP detail page", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "1.2.3.4" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "1.2.3.4" })).toHaveAttribute("href", "/ip/1.2.3.4");
  });

  it("renders empty states and skips charts when there is no data", async () => {
    vi.stubGlobal(
      "fetch",
      stubOverviewFetch({
        ...FULL_OVERVIEW,
        top_countries: [],
        top_offenders: [],
        protocol_split: [],
        bans_timeline: [],
        top_credentials: [],
        duration_distribution: [
          { bucket: "<10s", n: 0 },
          { bucket: "10-60s", n: 0 },
          { bucket: "1-5min", n: 0 },
          { bucket: "5-30min", n: 0 },
          { bucket: ">30min", n: 0 },
        ],
      })
    );
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getAllByText("Aucune donnée")).toHaveLength(7));
    expect(screen.getByTestId("timeline-chart-stub")).toBeInTheDocument();
  });

  it("shows an error state and recovers via the retry button", async () => {
    const fetchMock = vi.fn((url: string) =>
      url.includes("/heatmap")
        ? jsonResponse(EMPTY_HEATMAP)
        : Promise.resolve({ ok: false, status: 500 } as Response)
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("Erreur de chargement, réessaie.")).toBeInTheDocument());

    fetchMock.mockImplementationOnce(() => jsonResponse(FULL_OVERVIEW));
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
  });

  it("auto-refreshes every 10s without flashing the skeleton again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubOverviewFetch(FULL_OVERVIEW);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(document.querySelector(".skeleton-block")).toBeNull();
  });

  it("reads the initial period from a pre-set PeriodContext value, not just the default", async () => {
    localStorage.setItem("period", "7d");
    const fetchMock = stubOverviewFetch(FULL_OVERVIEW);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PeriodProvider>
            <OverviewPage />
          </PeriodProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=7d"));
    localStorage.clear();
  });

  it("navigates to a protocol-filtered Sessions view when a donut slice is clicked", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    function Harness() {
      return (
        <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/sessions" element={<div>Sessions stub</div>} />
        </Routes>
      );
    }
    renderWithProviders(<Harness />, { route: "/overview" });
    await waitFor(() => expect(screen.getByTestId("protocol-donut-stub")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Simulate protocol click" }));
    await waitFor(() => expect(screen.getByText("Sessions stub")).toBeInTheDocument());
  });

  it("navigates to a country-filtered Sessions view when a top-country row is clicked", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    function Harness() {
      return (
        <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/sessions" element={<div>Sessions stub</div>} />
        </Routes>
      );
    }
    renderWithProviders(<Harness />, { route: "/overview" });
    await waitFor(() => expect(screen.getByRole("link", { name: "France" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("link", { name: "France" }));
    await waitFor(() => expect(screen.getByText("Sessions stub")).toBeInTheDocument());
  });

  it("navigates to a date-range-filtered Sessions view when a bans bar is clicked", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    function Harness() {
      return (
        <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/sessions" element={<div>Sessions stub</div>} />
        </Routes>
      );
    }
    renderWithProviders(<Harness />, { route: "/overview" });
    await waitFor(() => expect(screen.getByTestId("bans-bar-chart-stub")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Simulate bar click" }));
    await waitFor(() => expect(screen.getByText("Sessions stub")).toBeInTheDocument());
  });

  it("shows a 'view these sessions' action only while the timeline is zoomed, and clears it on reset", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId("timeline-chart-stub")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Voir les sessions de cette période" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Simulate zoom" }));
    expect(screen.getByRole("button", { name: "Voir les sessions de cette période" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Simulate reset" }));
    expect(screen.queryByRole("button", { name: "Voir les sessions de cette période" })).not.toBeInTheDocument();
  });

  it("navigates to a date-range-filtered Sessions view from the zoomed timeline action", async () => {
    vi.stubGlobal("fetch", stubOverviewFetch(FULL_OVERVIEW));
    function Harness() {
      return (
        <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/sessions" element={<div>Sessions stub</div>} />
        </Routes>
      );
    }
    renderWithProviders(<Harness />, { route: "/overview" });
    await waitFor(() => expect(screen.getByTestId("timeline-chart-stub")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Simulate zoom" }));
    await userEvent.click(screen.getByRole("button", { name: "Voir les sessions de cette période" }));
    await waitFor(() => expect(screen.getByText("Sessions stub")).toBeInTheDocument());
  });
});
