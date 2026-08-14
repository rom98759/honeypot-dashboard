import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../test-utils";
import { MapPage } from "./MapPage";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const POINTS_LOW = {
  points: [
    { city: "Paris", country: "France", latitude: 48.85, longitude: 2.35, session_count: 3, ips: ["1.2.3.4"] },
  ],
  destination: { latitude: 51.0162051, longitude: 2.1556627 },
};

const POINTS_HIGH = {
  points: [
    {
      city: "Paris",
      country: "France",
      latitude: 48.85,
      longitude: 2.35,
      session_count: 5,
      ips: ["1.2.3.4", "9.9.9.9"],
    },
  ],
  destination: { latitude: 51.0162051, longitude: 2.1556627 },
};

describe("MapPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a skeleton then the map with markers", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(POINTS_LOW)));
    const { container } = renderWithProviders(<MapPage />, { route: "/map" });
    expect(container.querySelector(".skeleton-block")).not.toBeNull();
    await waitFor(() => expect(container.querySelectorAll(".map-marker")).toHaveLength(1));
  });

  it("switches period and refetches with the new value", async () => {
    const fetchMock = vi.fn(() => jsonResponse(POINTS_LOW));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("button", { name: "7j" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/map?period=24h");

    await userEvent.click(screen.getByRole("button", { name: "7j" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/map?period=7d"));
  });

  it("toggles Live via the button", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(POINTS_LOW)));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Live: OFF" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Live: OFF" }));
    expect(screen.getByRole("button", { name: "Live: ON" })).toBeInTheDocument();
  });

  it("shows a tooltip with a per-IP Sessions link when a marker is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(POINTS_LOW)));
    const { container } = renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() => expect(container.querySelectorAll(".map-marker")).toHaveLength(1));

    await userEvent.click(container.querySelector(".map-marker")!);
    expect(screen.getByText("Paris")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1\.2\.3\.4/ })).toHaveAttribute("href", "/sessions?ip=1.2.3.4");
  });

  it("enabling Live starts 10s polling and draws an arrival line when a point's count increases", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => jsonResponse(POINTS_LOW));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderWithProviders(<MapPage />, { route: "/map?live=true" });
    await waitFor(() => expect(container.querySelectorAll(".map-marker")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".attack-line")).toHaveLength(0);

    fetchMock.mockImplementation(() => jsonResponse(POINTS_HIGH));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".attack-line")).toHaveLength(1);
  });

  it("shows an empty state when there are no geolocated points", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ points: [], destination: null })));
    renderWithProviders(<MapPage />, { route: "/map" });
    await waitFor(() =>
      expect(screen.getByText("Aucune attaque géolocalisée pour cette période")).toBeInTheDocument()
    );
  });
});
