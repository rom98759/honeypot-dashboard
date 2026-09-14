import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { doughnutSpy } = vi.hoisted(() => ({ doughnutSpy: vi.fn() }));

vi.mock("react-chartjs-2", () => ({
  Doughnut: (props: Record<string, unknown>) => {
    doughnutSpy(props);
    return <div data-testid="doughnut-stub" />;
  },
}));

import { ProtocolDonut } from "./ProtocolDonut";
import { ThemeProvider } from "../theme/ThemeContext";

describe("ProtocolDonut", () => {
  it("maps protocol codes to French labels and known colors", () => {
    render(
      <ThemeProvider>
        <ProtocolDonut
          protocolSplit={[
            { protocol: "ssh", n: 8 },
            { protocol: "telnet", n: 2 },
          ]}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("doughnut-stub")).toBeInTheDocument();
    const props = doughnutSpy.mock.calls[0][0] as {
      data: { labels: string[]; datasets: { data: number[]; backgroundColor: string[] }[] };
    };
    expect(props.data.labels).toEqual(["SSH", "Telnet"]);
    expect(props.data.datasets[0].data).toEqual([8, 2]);
    expect(props.data.datasets[0].backgroundColor).toEqual(["#2563eb", "#d97706"]);
  });

  it("falls back to the raw protocol string for an unrecognized value", () => {
    render(
      <ThemeProvider>
        <ProtocolDonut protocolSplit={[{ protocol: "rdp", n: 1 }]} />
      </ThemeProvider>
    );
    const lastCall = doughnutSpy.mock.calls[doughnutSpy.mock.calls.length - 1][0] as {
      data: { labels: string[] };
    };
    expect(lastCall.data.labels).toEqual(["rdp"]);
  });

  it("reads legend label color from CSS custom properties and doesn't crash", () => {
    render(
      <ThemeProvider>
        <ProtocolDonut protocolSplit={[{ protocol: "ssh", n: 1 }]} />
      </ThemeProvider>
    );
    const props = doughnutSpy.mock.calls[doughnutSpy.mock.calls.length - 1][0] as {
      options: { plugins: { legend: { labels: { color: string } } } };
    };
    expect(typeof props.options.plugins.legend.labels.color).toBe("string");
  });
});
