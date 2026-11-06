import { screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { PeriodProvider } from "../theme/PeriodContext";
import { ThemeProvider } from "../theme/ThemeContext";
import { OverviewPage } from "./OverviewPage";
import type { SeriesPoint } from "../utils/timeSeries";

vi.mock("../components/ActivityChart", () => ({
  ActivityChart: ({
    series,
    onBucketClick,
  }: {
    series: SeriesPoint[];
    onBucketClick?: (p: SeriesPoint) => void;
  }) => (
    <div data-testid="activity-chart-stub">
      {series.length}
      <button
        onClick={() =>
          onBucketClick?.({ ...series[0], from: "2026-08-13T10", to: "2026-08-13T11" })
        }
      >
        Simulate bucket click
      </button>
    </div>
  ),
}));

vi.mock("../components/BansBarChart", () => ({
  BansBarChart: ({ onBarClick }: { onBarClick?: (bucket: string) => void }) => (
    <button onClick={() => onBarClick?.("2026-08-13")}>Simulate bar click</button>
  ),
}));

vi.mock("../components/WorldMap", () => ({
  WorldMap: ({
    countries,
    onCountryClick,
  }: {
    countries: { country: string }[];
    onCountryClick?: (c: { country: string }) => void;
  }) => (
    <div data-testid="world-map-stub">
      {countries.length}
      <button onClick={() => onCountryClick?.(countries[0])}>Simulate country click</button>
    </div>
  ),
}));

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const EMPTY_HEATMAP = { cells: [] };

const FULL_OVERVIEW = {
  total_connections: 12,
  unique_ips: 4,
  login_attempts: 3,
  avg_duration_ms: 67_000,
  previous: { total_connections: 6, unique_ips: 4, login_attempts: 6, avg_duration_ms: 67_000 },
  active_sessions: 2,
  currently_banned: 1,
  top_offenders: [
    { src_ip: "1.2.3.4", n: 6, country: "France", country_code: "FR", last_seen: "2026-08-13T10:00:00Z" },
  ],
  top_countries: [{ country: "France", country_code: "FR", n: 6 }],
  countries: [{ country: "France", country_code: "FR", n: 6 }],
  timeline: [{ bucket: "2026-08-13T10", n: 6, logins: 3 }],
  protocol_split: [
    { protocol: "ssh", n: 10 },
    { protocol: "telnet", n: 2 },
  ],
  top_credentials: [
    { login_username: "root", login_password: "123456", n: 5 },
    { login_username: "admin", login_password: null, n: 1 },
  ],
  top_usernames: [{ value: "root", n: 5 }],
  top_passwords: [{ value: "123456", n: 5 }],
  top_commands: [{ input_text: "uname -a", n: 4 }],
  bans_timeline: [{ bucket: "2026-08-13T10", n: 2 }],
  duration_distribution: [
    { bucket: "<10s", n: 1 },
    { bucket: "10-60s", n: 0 },
    { bucket: "1-5min", n: 3 },
    { bucket: "5-30min", n: 0 },
    { bucket: ">30min", n: 0 },
  ],
};

function stubFetch(overview: unknown = FULL_OVERVIEW) {
  const mock = vi.fn((url: string) =>
    url.includes("/heatmap") ? jsonResponse(EMPTY_HEATMAP) : jsonResponse(overview)
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(route = "/overview") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider>
          <PeriodProvider>
            <Routes>
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="*" element={<div>other page</div>} />
            </Routes>
            <LocationProbe />
          </PeriodProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const overviewCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map(([url]) => url as string).filter((u) => !u.includes("/heatmap"));

describe("OverviewPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a skeleton before data resolves, then the metric cards", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/heatmap")
          ? jsonResponse(EMPTY_HEATMAP)
          : new Promise<Response>((resolve) => (resolveFetch = resolve))
      )
    );
    const { container } = renderPage();
    expect(container.querySelector(".skeleton-block")).not.toBeNull();

    resolveFetch({ ok: true, json: async () => FULL_OVERVIEW } as Response);
    await waitFor(() => expect(screen.getByText("Connexions")).toBeInTheDocument());
    expect(container.querySelector(".skeleton-block")).toBeNull();
    expect(screen.getByText("1m 7s")).toBeInTheDocument();
    expect(screen.getByText("2 en cours")).toBeInTheDocument();
  });

  it("shows the change against the previous period, with attacks rising in red", async () => {
    stubFetch();
    renderPage();
    const card = (await screen.findByText("Connexions")).closest(".metric-card")!;
    const change = within(card as HTMLElement).getByTestId("change-label");
    expect(change).toHaveTextContent("100%");
    expect(change).toHaveClass("negative");

    const logins = screen.getByText("Logins tentés").closest(".metric-card")!;
    expect(within(logins as HTMLElement).getByTestId("change-label")).toHaveClass("positive");
  });

  it("fetches the default 24h period and refetches when the period changes", async () => {
    const fetchMock = stubFetch();
    renderPage();
    await screen.findByText("Connexions");
    expect(overviewCalls(fetchMock)[0]).toBe("/api/overview?period=24h");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Période" }), "7d");
    await waitFor(() => expect(overviewCalls(fetchMock)).toContain("/api/overview?period=7d"));
    expect(screen.getByTestId("location")).toHaveTextContent("period=7d");
  });

  it("adds a filter when a list row is clicked, and removes it from its chip", async () => {
    const fetchMock = stubFetch();
    renderPage();
    await screen.findByText("Connexions");

    await userEvent.click(screen.getByRole("tab", { name: "Pays" }));
    await userEvent.click(screen.getByRole("button", { name: /France/ }));

    await waitFor(() =>
      expect(overviewCalls(fetchMock)).toContain("/api/overview?period=24h&filter=country%3AFR")
    );
    expect(screen.getByText("Pays", { selector: ".filter-chip b" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Requête de recherche" })).toHaveValue("country:FR");

    await userEvent.click(screen.getByRole("button", { name: "Retirer le filtre Pays" }));
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("filter="));
  });

  it("adds a filter from the filter popover", async () => {
    const fetchMock = stubFetch();
    renderPage();
    await screen.findByText("Connexions");

    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    const form = screen.getByRole("form", { name: "Ajouter un filtre" });
    await userEvent.selectOptions(within(form).getByLabelText("Champ"), "proto");
    await userEvent.selectOptions(within(form).getByLabelText("Condition"), "not");
    await userEvent.type(within(form).getByLabelText("Valeur"), "telnet");
    await userEvent.click(within(form).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(overviewCalls(fetchMock)).toContain("/api/overview?period=24h&filter=-proto%3Atelnet")
    );
    expect(screen.getByText("n'est pas", { selector: ".filter-chip .op" })).toBeInTheDocument();
  });

  it("applies a typed query on Enter and explains a syntax error without sending it", async () => {
    const fetchMock = stubFetch();
    renderPage();
    await screen.findByText("Connexions");
    const input = screen.getByRole("textbox", { name: "Requête de recherche" });

    await userEvent.type(input, "foo:bar{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("champ inconnu « foo »");
    expect(overviewCalls(fetchMock).some((u) => u.includes("filter="))).toBe(false);

    await userEvent.clear(input);
    await userEvent.type(input, "country:CN,RU -user:root dur>60{Enter}");
    await waitFor(() =>
      expect(overviewCalls(fetchMock)).toContain(
        "/api/overview?period=24h&filter=country%3ACN%2CRU+-user%3Aroot+dur%3E60"
      )
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("CN ou RU")).toBeInTheDocument();
    expect(screen.getByText("Durée", { selector: ".filter-chip b" })).toBeInTheDocument();
  });

  it("applies filters already present in the URL and forwards them to the sessions link", async () => {
    const fetchMock = stubFetch();
    renderPage("/overview?ip=1.2.3.4&protocol=ssh");
    await screen.findByText("Connexions");

    // Older ?ip= / ?protocol= links are read as search terms.
    expect(overviewCalls(fetchMock)[0]).toBe("/api/overview?period=24h&filter=ip%3A1.2.3.4+proto%3Assh");
    expect(screen.getByRole("link", { name: /Voir les sessions/ })).toHaveAttribute(
      "href",
      "/sessions?period=24h&filter=ip%3A1.2.3.4+proto%3Assh"
    );
  });

  it("shows (vide) for a null attempted password", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText("admin / (vide)")).toBeInTheDocument();
  });

  it("links an offender to its IP page and filters on it when the row is clicked", async () => {
    const fetchMock = stubFetch();
    renderPage();
    expect(await screen.findByRole("link", { name: "Détail de 1.2.3.4" })).toHaveAttribute("href", "/ip/1.2.3.4");

    await userEvent.click(screen.getByText("1.2.3.4"));
    await waitFor(() =>
      expect(overviewCalls(fetchMock)).toContain("/api/overview?period=24h&filter=ip%3A1.2.3.4")
    );
  });

  it("navigates to the sessions running a command when a command row is clicked", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(await screen.findByText("uname -a"));
    expect(screen.getByTestId("location")).toHaveTextContent("/sessions?period=24h&command=uname+-a");
  });

  it("navigates to a date-range-filtered sessions view from a chart bar", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Simulate bucket click" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/sessions?date_from=2026-08-13T10&date_to=2026-08-13T11"
    );
  });

  it("navigates to a date-range-filtered sessions view from a bans bar", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Connexions");
    await userEvent.click(screen.getByRole("tab", { name: "Bans fail2ban" }));
    await userEvent.click(screen.getByRole("button", { name: "Simulate bar click" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/sessions?date_from=2026-08-13&date_to=2026-08-14"
    );
  });

  it("filters on a country clicked on the map", async () => {
    const fetchMock = stubFetch();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Simulate country click" }));
    await waitFor(() =>
      expect(overviewCalls(fetchMock)).toContain("/api/overview?period=24h&filter=country%3AFR")
    );
  });

  it("renders empty states when there is no data", async () => {
    stubFetch({
      ...FULL_OVERVIEW,
      previous: null,
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
    });
    localStorage.setItem("period", "all");
    renderPage();
    await screen.findByText("Connexions");
    expect(screen.queryByTestId("change-label")).toBeNull();
    expect(screen.getByText("Aucune session sur la période")).toBeInTheDocument();
    expect(screen.getAllByText("Aucune donnée").length).toBeGreaterThan(0);
  });

  it("shows an error state and recovers via the retry button", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/heatmap")) return jsonResponse(EMPTY_HEATMAP);
        if (fail) return Promise.resolve({ ok: false, status: 500 } as Response);
        return jsonResponse(FULL_OVERVIEW);
      })
    );
    renderPage();
    await screen.findByText("Erreur de chargement, réessaie.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Connexions")).toBeInTheDocument();
  });

  it("auto-refreshes every 10s without flashing the skeleton again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFetch();
    const { container } = renderPage();
    await screen.findByText("Connexions");
    const before = overviewCalls(fetchMock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(overviewCalls(fetchMock).length).toBeGreaterThan(before));
    expect(container.querySelector(".skeleton-block")).toBeNull();
  });
});
