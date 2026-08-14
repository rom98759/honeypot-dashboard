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

describe("BansBarChart", () => {
  it("maps bucket/n pairs to chart labels and data", () => {
    render(
      <BansBarChart
        bansTimeline={[
          { bucket: "2026-08-13", n: 4 },
          { bucket: "2026-08-14", n: 1 },
        ]}
      />
    );
    expect(screen.getByTestId("bar-stub")).toBeInTheDocument();
    const props = barSpy.mock.calls[0][0] as {
      data: { labels: string[]; datasets: { data: number[] }[] };
    };
    expect(props.data.labels).toEqual(["2026-08-13", "2026-08-14"]);
    expect(props.data.datasets[0].data).toEqual([4, 1]);
  });

  it("renders with an empty bansTimeline without throwing", () => {
    render(<BansBarChart bansTimeline={[]} />);
    expect(screen.getByTestId("bar-stub")).toBeInTheDocument();
  });
});
