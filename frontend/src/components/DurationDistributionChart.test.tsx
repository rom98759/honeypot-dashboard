import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { barSpy } = vi.hoisted(() => ({ barSpy: vi.fn() }));

vi.mock("react-chartjs-2", () => ({
  Bar: (props: Record<string, unknown>) => {
    barSpy(props);
    return <div data-testid="bar-stub" />;
  },
}));

import { DurationDistributionChart } from "./DurationDistributionChart";
import { ThemeProvider } from "../theme/ThemeContext";

describe("DurationDistributionChart", () => {
  it("maps bucket/n pairs to chart labels and data, in the given order", () => {
    render(
      <ThemeProvider>
        <DurationDistributionChart
          distribution={[
            { bucket: "<10s", n: 3 },
            { bucket: "10-60s", n: 1 },
            { bucket: "1-5min", n: 0 },
            { bucket: "5-30min", n: 0 },
            { bucket: ">30min", n: 2 },
          ]}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("bar-stub")).toBeInTheDocument();
    const props = barSpy.mock.calls[0][0] as {
      data: { labels: string[]; datasets: { data: number[] }[] };
    };
    expect(props.data.labels).toEqual(["<10s", "10-60s", "1-5min", "5-30min", ">30min"]);
    expect(props.data.datasets[0].data).toEqual([3, 1, 0, 0, 2]);
  });

  it("renders with an empty distribution without throwing", () => {
    render(
      <ThemeProvider>
        <DurationDistributionChart distribution={[]} />
      </ThemeProvider>
    );
    expect(screen.getByTestId("bar-stub")).toBeInTheDocument();
  });
});
