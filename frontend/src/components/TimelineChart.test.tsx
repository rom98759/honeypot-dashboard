import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-chartjs-2", () => ({
  Line: (props: { data: { datasets: { data: number[] }[] } }) => (
    <div data-testid="line-chart">{JSON.stringify(props.data.datasets[0].data)}</div>
  ),
}));

import { TimelineChart, ChartErrorBoundary } from "./TimelineChart";
import { ThemeProvider } from "../theme/ThemeContext";

describe("TimelineChart", () => {
  it("passes the timeline's counts to the underlying chart", () => {
    render(
      <ThemeProvider>
        <TimelineChart
          timeline={[
            { bucket: "2026-08-13T10", n: 5 },
            { bucket: "2026-08-13T11", n: 8 },
          ]}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("line-chart")).toHaveTextContent("[5,8]");
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
