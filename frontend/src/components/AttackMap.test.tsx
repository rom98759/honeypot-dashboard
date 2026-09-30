import { render, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { geoEqualEarth } from "d3-geo";

const { zoomableGroupSpy, geographiesSpy } = vi.hoisted(() => ({
  zoomableGroupSpy: vi.fn(),
  geographiesSpy: vi.fn(),
}));

vi.mock("react-simple-maps", () => ({
  ComposableMap: ({ children }: { children: React.ReactNode }) => <div data-testid="composable-map">{children}</div>,
  Geographies: ({ geography, children }: { geography: unknown; children: (props: { geographies: unknown[] }) => React.ReactNode }) => {
    geographiesSpy({ geography });
    return <>{children({ geographies: [] })}</>;
  },
  Geography: () => null,
  ZoomableGroup: (props: Record<string, unknown>) => {
    zoomableGroupSpy(props);
    return <div data-testid="zoomable-group">{props.children as React.ReactNode}</div>;
  },
  Line: (props: Record<string, unknown>) => <div className="attack-line" data-from={JSON.stringify(props.from)} />,
}));

const { heatSpy, dataSpy, maxSpy, gradientSpy, drawSpy } = vi.hoisted(() => ({
  heatSpy: vi.fn(),
  dataSpy: vi.fn(),
  maxSpy: vi.fn(),
  gradientSpy: vi.fn(),
  drawSpy: vi.fn(),
}));

vi.mock("simpleheat", () => ({
  default: (canvas: unknown) => {
    heatSpy(canvas);
    return {
      data: dataSpy,
      max: maxSpy,
      gradient: gradientSpy,
      draw: drawSpy,
    };
  },
}));

import { AttackMap } from "./AttackMap";

const POINTS = [
  { latitude: 48.85, longitude: 2.35, count: 5 },
  { latitude: 52.52, longitude: 13.4, count: 10 },
];

describe("AttackMap", () => {
  it("draws the heatmap with a data point per HeatPoint at the default (unzoomed) projection", () => {
    render(<AttackMap heatPoints={POINTS} destination={null} arrivingPoints={[]} />);
    expect(dataSpy).toHaveBeenCalled();
    const drawnPoints = dataSpy.mock.calls[dataSpy.mock.calls.length - 1][0] as [number, number, number][];
    expect(drawnPoints).toHaveLength(2);
    expect(drawnPoints[0][2]).toBe(5);
    expect(drawnPoints[1][2]).toBe(10);
  });

  it("uses the classic blue-yellow-red gradient", () => {
    render(<AttackMap heatPoints={POINTS} destination={null} arrivingPoints={[]} />);
    expect(gradientSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ 1: expect.stringContaining("ff3b3b") })
    );
  });

  it("re-projects heatmap points when the zoom/pan state changes via onMove (not only onMoveEnd)", () => {
    render(<AttackMap heatPoints={POINTS} destination={null} arrivingPoints={[]} />);
    dataSpy.mockClear();

    const zoomableGroupProps = zoomableGroupSpy.mock.calls[zoomableGroupSpy.mock.calls.length - 1][0] as {
      onMove: (state: { x: number; y: number; zoom: number }) => void;
    };

    // react-simple-maps' ZoomableGroup calls onMove mid-gesture with the raw d3-zoom
    // transform { x, y, zoom } (screen-pixel translate + scale), not a pre-computed
    // { coordinates, zoom } — only onMoveStart/onMoveEnd get that. Build the transform
    // that a real drag-to-center-on-point-1-at-zoom-2 gesture would produce, using the
    // same projection setup AttackMap itself uses (WIDTH/HEIGHT/scale/translate), via
    // the inverse of react-simple-maps' own getCoords helper.
    const WIDTH = 800;
    const HEIGHT = 500;
    const projection = geoEqualEarth().scale(140).translate([WIDTH / 2, HEIGHT / 2]);
    const zoom = 2;
    const [px, py] = projection([2.35, 48.85]) as [number, number];
    const xOffset = (WIDTH * zoom - WIDTH) / 2;
    const yOffset = (HEIGHT * zoom - HEIGHT) / 2;
    const x = zoom * (WIDTH / 2 - px) - xOffset;
    const y = zoom * (HEIGHT / 2 - py) - yOffset;

    act(() => {
      zoomableGroupProps.onMove({ x, y, zoom });
    });

    expect(dataSpy).toHaveBeenCalled();
    const drawnPoints = dataSpy.mock.calls[dataSpy.mock.calls.length - 1][0] as [number, number, number][];
    // Zoomed in (zoom: 2) centered exactly on the first point: its projected coordinate
    // must now land at the canvas center, distinct from the unzoomed projection.
    expect(drawnPoints[0][0]).toBeCloseTo(400, 0); // WIDTH / 2
    expect(drawnPoints[0][1]).toBeCloseTo(250, 0); // HEIGHT / 2
  });

  it("renders an arrival line only for points in arrivingPoints, and only when destination is set", () => {
    const { container, rerender } = render(
      <AttackMap
        heatPoints={POINTS}
        destination={{ latitude: 51.0162051, longitude: 2.1556627 }}
        arrivingPoints={[{ latitude: 48.85, longitude: 2.35, count: 5 }]}
      />
    );
    expect(container.querySelectorAll(".attack-line")).toHaveLength(1);

    rerender(<AttackMap heatPoints={POINTS} destination={null} arrivingPoints={[{ latitude: 48.85, longitude: 2.35, count: 5 }]} />);
    expect(container.querySelectorAll(".attack-line")).toHaveLength(0);
  });

  it("renders without crashing when heatPoints is empty", () => {
    render(<AttackMap heatPoints={[]} destination={null} arrivingPoints={[]} />);
    expect(dataSpy).toHaveBeenCalledWith([]);
  });
});
