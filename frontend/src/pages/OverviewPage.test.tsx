import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../test-utils";
import { OverviewPage } from "./OverviewPage";

vi.mock("../components/TimelineChart", () => ({
  TimelineChart: ({ timeline }: { timeline: { hour: string; n: number }[] }) => (
    <div data-testid="timeline-chart-stub">{timeline.length}</div>
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
  timeline: [{ hour: "2026-08-13T10", n: 6 }],
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

  it("renders empty states and skips the chart when there is no data", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ ...FULL_OVERVIEW, top_countries: [], top_ips: [] })));
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getAllByText("Aucune donnée")).toHaveLength(2));
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
