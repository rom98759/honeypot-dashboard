import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { lineSpy } = vi.hoisted(() => ({ lineSpy: vi.fn() }));

vi.mock("react-chartjs-2", () => ({
  Line: (props: Record<string, unknown>) => {
    lineSpy(props);
    return <div data-testid="line-chart" />;
  },
}));

import { TimelineChart, ChartErrorBoundary } from "./TimelineChart";
import { ThemeProvider } from "../theme/ThemeContext";

describe("TimelineChart", () => {
  it("passes the timeline's counts to the underlying chart", () => {
    render(
      <ThemeProvider>
        <TimelineChart timeline={[{ bucket: "2026-08-13T10", n: 5 }, { bucket: "2026-08-13T11", n: 8 }]} />
      </ThemeProvider>
    );
    const props = lineSpy.mock.calls[lineSpy.mock.calls.length - 1][0] as {
      data: { datasets: { data: number[] }[] };
    };
    expect(props.data.datasets[0].data).toEqual([5, 8]);
  });

  it("renders without crashing in dark mode", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(
      <ThemeProvider>
        <TimelineChart timeline={[{ bucket: "2026-08-13T10", n: 5 }]} />
      </ThemeProvider>
    );
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });

  it("configures drag-to-zoom on the x axis and reports the visible range via onRangeChange", () => {
    const onRangeChange = vi.fn();
    render(
      <ThemeProvider>
        <TimelineChart
          timeline={[
            { bucket: "2026-08-13T10", n: 5 },
            { bucket: "2026-08-13T11", n: 8 },
            { bucket: "2026-08-13T12", n: 2 },
          ]}
          onRangeChange={onRangeChange}
        />
      </ThemeProvider>
    );
    const props = lineSpy.mock.calls[lineSpy.mock.calls.length - 1][0] as {
      options: { plugins: { zoom: { onZoomComplete: (ctx: unknown) => void } } };
    };
    const fakeChart = { scales: { x: { min: 1, max: 2 } } };
    props.options.plugins.zoom.onZoomComplete({ chart: fakeChart });
    expect(onRangeChange).toHaveBeenCalledWith({ start: "2026-08-13T11", end: "2026-08-13T12" });
  });

  it("reports null via onRangeChange when the visible range covers the whole timeline", () => {
    const onRangeChange = vi.fn();
    render(
      <ThemeProvider>
        <TimelineChart
          timeline={[{ bucket: "2026-08-13T10", n: 5 }, { bucket: "2026-08-13T11", n: 8 }]}
          onRangeChange={onRangeChange}
        />
      </ThemeProvider>
    );
    const props = lineSpy.mock.calls[lineSpy.mock.calls.length - 1][0] as {
      options: { plugins: { zoom: { onZoomComplete: (ctx: unknown) => void } } };
    };
    const fakeChart = { scales: { x: { min: 0, max: 1 } } };
    props.options.plugins.zoom.onZoomComplete({ chart: fakeChart });
    expect(onRangeChange).toHaveBeenCalledWith(null);
  });
});

describe("ChartErrorBoundary", () => {
  function Throws(): never {
    throw new Error("boom");
  }

  it("shows a fallback message instead of crashing the page", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ChartErrorBoundary>
        <Throws />
      </ChartErrorBoundary>
    );
    expect(screen.getByText("Graphique indisponible.")).toBeInTheDocument();
    spy.mockRestore();
  });
});
