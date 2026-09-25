import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { barSpy } = vi.hoisted(() => ({ barSpy: vi.fn() }));

vi.mock("react-chartjs-2", () => ({
  Bar: (props: Record<string, unknown>) => {
    barSpy(props);
    return <div data-testid="bar-stub" />;
  },
}));

import { BansBarChart } from "./BansBarChart";
import { ThemeProvider } from "../theme/ThemeContext";

describe("BansBarChart", () => {
  it("maps bucket/n pairs to chart labels and data", () => {
    render(
      <ThemeProvider>
        <BansBarChart
          bansTimeline={[
            { bucket: "2026-08-13", n: 4 },
            { bucket: "2026-08-14", n: 1 },
          ]}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("bar-stub")).toBeInTheDocument();
    const props = barSpy.mock.calls[0][0] as {
      data: { labels: string[]; datasets: { data: number[] }[] };
    };
    expect(props.data.labels).toEqual(["2026-08-13", "2026-08-14"]);
    expect(props.data.datasets[0].data).toEqual([4, 1]);
  });

  it("renders with an empty bansTimeline without throwing", () => {
    render(
      <ThemeProvider>
        <BansBarChart bansTimeline={[]} />
      </ThemeProvider>
    );
    expect(screen.getByTestId("bar-stub")).toBeInTheDocument();
  });

  it("wires onClick to resolve the clicked bar back to its bucket label", () => {
    const onBarClick = vi.fn();
    render(
      <ThemeProvider>
        <BansBarChart
          bansTimeline={[
            { bucket: "2026-08-13", n: 4 },
            { bucket: "2026-08-14", n: 1 },
          ]}
          onBarClick={onBarClick}
        />
      </ThemeProvider>
    );
    const props = barSpy.mock.calls[barSpy.mock.calls.length - 1][0] as {
      options: { onClick: (event: unknown, elements: unknown, chart: unknown) => void };
    };
    const fakeChart = { getElementsAtEventForMode: vi.fn(() => [{ index: 1 }]) };
    props.options.onClick({ native: {} }, [], fakeChart);
    expect(onBarClick).toHaveBeenCalledWith("2026-08-14");
  });

  it("does not call onBarClick or throw when the click resolves to no element", () => {
    const onBarClick = vi.fn();
    render(
      <ThemeProvider>
        <BansBarChart bansTimeline={[{ bucket: "2026-08-13", n: 4 }]} onBarClick={onBarClick} />
      </ThemeProvider>
    );
    const props = barSpy.mock.calls[barSpy.mock.calls.length - 1][0] as {
      options: { onClick: (event: unknown, elements: unknown, chart: unknown) => void };
    };
    const fakeChart = { getElementsAtEventForMode: vi.fn(() => []) };
    expect(() => props.options.onClick({ native: {} }, [], fakeChart)).not.toThrow();
    expect(onBarClick).not.toHaveBeenCalled();
  });
});
