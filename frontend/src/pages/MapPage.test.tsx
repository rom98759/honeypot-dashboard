import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "../test-utils";
import { MapPage } from "./MapPage";
import { OverviewPage } from "./OverviewPage";
import { PeriodProvider } from "../theme/PeriodContext";

vi.mock("../components/AttackMap", () => ({
  AttackMap: ({ heatPoints, arrivingPoints }: { heatPoints: { count: number }[]; arrivingPoints: unknown[] }) => (
    <div data-testid="attack-map-stub">
      <span data-testid="heat-point-count">{heatPoints.length}</span>
      <span data-testid="arriving-count">{arrivingPoints.length}</span>
    </div>
  ),
}));

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const EVENTS_LOW = {
  events: [{ ip: "1.2.3.4", city: "Paris", country: "France", latitude: 48.85, longitude: 2.35, connect_time: "2026-08-14T10:00:00Z" }],
  destination: { latitude: 51.0162051, longitude: 2.1556627 },
};

const EVENTS_HIGH = {
  events: [
    { ip: "1.2.3.4", city: "Paris", country: "France", latitude: 48.85, longitude: 2.35, connect_time: "2026-08-14T10:00:00Z" },
    { ip: "9.9.9.9", city: "Paris", country: "France", latitude: 48.85, longitude: 2.35, connect_time: "2026-08-14T10:05:00Z" },
  ],
  destination: { latitude: 51.0162051, longitude: 2.1556627 },
};

describe("MapPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("shows a skeleton then the map with aggregated heat points", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(EVENTS_LOW)));
    const { container } = renderWithProviders(<MapPage />, { route: "/map" });
    expect(container.querySelector(".skeleton-block")).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("heat-point-count")).toHaveTextContent("1"));
  });

  it("switches period and refetches with the new value", async () => {
    const fetchMock = vi.fn(() => jsonResponse(EVENTS_LOW));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("button", { name: "7j" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/map?period=24h");

    await userEvent.click(screen.getByRole("button", { name: "7j" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/map?period=7d"));
  });

  it("toggles Live via the button", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(EVENTS_LOW)));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Live: OFF" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Live: OFF" }));
    expect(screen.getByRole("button", { name: "Live: ON" })).toBeInTheDocument();
  });

  it("enabling Live starts 10s polling and draws an arrival line when a point's count increases", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => jsonResponse(EVENTS_LOW));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<MapPage />, { route: "/map?live=true" });
    await waitFor(() => expect(screen.getByTestId("heat-point-count")).toHaveTextContent("1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("arriving-count")).toHaveTextContent("0");

    fetchMock.mockImplementation(() => jsonResponse(EVENTS_HIGH));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("arriving-count")).toHaveTextContent("1");
  });

  it("shows an empty state when there are no geolocated events", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ events: [], destination: null })));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() =>
      expect(screen.getByText("Aucune attaque géolocalisée pour cette période")).toBeInTheDocument()
    );
  });

  it("engaging the scrubber turns Live off", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(EVENTS_LOW)));
    renderWithProviders(<MapPage />, { route: "/map?live=true" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Live: ON" })).toBeInTheDocument());

    const slider = screen.getByRole("slider") as HTMLInputElement;
    const midpoint = String(Math.round(Number(slider.max) / 2));
    fireEvent.change(slider, { target: { value: midpoint } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Live: OFF" })).toBeInTheDocument());
  });

  it("turning Live on resets the scrubber to the full range", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(EVENTS_LOW)));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("slider")).toBeInTheDocument());

    const slider = screen.getByRole("slider") as HTMLInputElement;
    const midpoint = String(Math.round(Number(slider.max) / 2));
    fireEvent.change(slider, { target: { value: midpoint } });
    expect(Number(slider.value)).toBe(Number(midpoint));

    await userEvent.click(screen.getByRole("button", { name: "Live: OFF" }));
    await waitFor(() => expect(Number(slider.value)).toBe(Number(slider.max)));
  });

  it("turning Live on while the scrubber is playing actually stops the playback interval, not just hides it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(EVENTS_HIGH)));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("slider")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /lecture/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // several playback ticks in
    });
    const slider = screen.getByRole("slider") as HTMLInputElement;
    const midPlaybackValue = Number(slider.value);
    expect(midPlaybackValue).toBeGreaterThan(0);
    expect(midPlaybackValue).toBeLessThan(Number(slider.max));

    await userEvent.click(screen.getByRole("button", { name: "Live: OFF" }));
    expect(Number(slider.value)).toBe(Number(slider.max));

    // If the old playback interval weren't actually cleared (only hidden/ignored), its next
    // tick would fire within 250ms and overwrite scrubCutoff away from null/max again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(Number(slider.value)).toBe(Number(slider.max));
    expect(screen.getByRole("button", { name: /lecture/i })).toBeInTheDocument();
  });

  it("switching period while the scrubber is playing actually stops the playback interval, not just hides it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(EVENTS_HIGH)));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("slider")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /lecture/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // several playback ticks in
    });
    const slider = screen.getByRole("slider") as HTMLInputElement;
    const midPlaybackValue = Number(slider.value);
    expect(midPlaybackValue).toBeGreaterThan(0);
    expect(midPlaybackValue).toBeLessThan(Number(slider.max));

    await userEvent.click(screen.getByRole("button", { name: "7j" }));
    await waitFor(() => {
      const refreshedSlider = screen.getByRole("slider") as HTMLInputElement;
      expect(Number(refreshedSlider.value)).toBe(Number(refreshedSlider.max));
    });

    // If the old playback interval weren't actually cleared (only hidden/ignored), its next
    // tick would fire within 250ms and overwrite scrubCutoff away from null/max again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const refreshedSlider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(refreshedSlider.value)).toBe(Number(refreshedSlider.max));
    expect(screen.getByRole("button", { name: /lecture/i })).toBeInTheDocument();
  });

  it("shares the period with OverviewPage through PeriodContext", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/overview/heatmap")) return jsonResponse({ cells: [] });
      if (url.includes("/overview")) {
        return jsonResponse({
          total_connections: 1,
          unique_ips: 1,
          login_attempts: 0,
          currently_banned: 0,
          top_offenders: [],
          top_countries: [],
          timeline: [],
          protocol_split: [],
          top_credentials: [],
          bans_timeline: [],
          duration_distribution: [],
        });
      }
      return jsonResponse({ events: [], destination: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PeriodProvider>
            <OverviewPage />
          </PeriodProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=24h"));
    await userEvent.click(await screen.findByRole("button", { name: "7j" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/overview?period=7d"));

    fetchMock.mockClear();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PeriodProvider>
            <MapPage />
          </PeriodProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/map?period=7d"));
  });
});
