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

  it("re-projects heatmap points when the zoom/pan state changes via continuous onMove sync", () => {
    render(<AttackMap heatPoints={POINTS} destination={null} arrivingPoints={[]} />);
    dataSpy.mockClear();

    const zoomableGroupProps = zoomableGroupSpy.mock.calls[zoomableGroupSpy.mock.calls.length - 1][0] as {
      onMove: (state: { x: number; y: number; zoom: number }) => void;
    };

    // react-simple-maps' ZoomableGroup calls onMove mid-gesture with the raw d3-zoom
    // transform { x, y, zoom } — the exact same screen-pixel translate (x, y) + scale (k)
    // it applies to its own SVG <g> as `translate(x, y) scale(k)` (see its
    // `transformString`, built straight from the d3-zoom transform with no lon/lat
    // involved). AttackMap now mirrors that directly: canvas point = [k*baseX + x,
    // k*baseY + y], where (baseX, baseY) = projection([lon, lat]) unscaled/untranslated
    // by zoom. Pick x/y/zoom so that point 1's base projection lands exactly at the
    // canvas center (400, 250) once scaled and translated — i.e. solve
    // k*baseX + x = 400 and k*baseY + y = 250 for a chosen k.
    //
    // Show-the-work numbers (computed with the same projection setup AttackMap uses:
    // geoEqualEarth().scale(140).translate([400, 250])):
    //   base = projection([2.35, 48.85]) = [404.1185659127185, 120.74424795167505]
    //   k = 2
    //   x = 400 - k*base[0] = -408.237131825437
    //   y = 250 - k*base[1] = 8.511504096649901
    //   check: k*base[0] + x = 400, k*base[1] + y = 250
    const WIDTH = 800;
    const HEIGHT = 500;
    const projection = geoEqualEarth().scale(140).translate([WIDTH / 2, HEIGHT / 2]);
    const zoom = 2;
    const [baseX, baseY] = projection([2.35, 48.85]) as [number, number];
    const x = WIDTH / 2 - zoom * baseX;
    const y = HEIGHT / 2 - zoom * baseY;

    act(() => {
      zoomableGroupProps.onMove({ x, y, zoom });
    });

    expect(dataSpy).toHaveBeenCalled();
    const drawnPoints = dataSpy.mock.calls[dataSpy.mock.calls.length - 1][0] as [number, number, number][];
    // Zoomed in (zoom: 2) with x/y chosen so point 1's projection lands exactly at the
    // canvas center, distinct from the unzoomed projection.
    expect(drawnPoints[0][0]).toBeCloseTo(400, 5); // WIDTH / 2
    expect(drawnPoints[0][1]).toBeCloseTo(250, 5); // HEIGHT / 2
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

  // Regression test for Critical #1 (`projection={() => projection}`): react-simple-maps
  // treats a function `projection` prop as the projection instance itself, so wrapping it
  // in a factory hands `Geographies`' internal `geoPath().projection(...)` a function with
  // no `.stream`. Mocking react-simple-maps (as the tests above do) hides this entirely —
  // this test lets the REAL `ComposableMap`/`Geographies`/projection machinery run against
  // the real `projection` object AttackMap passes, so a regression here throws for real.
  // Kept last in this file: it resets the module registry and unmocks react-simple-maps
  // for a fresh dynamic import, which must not affect the static `AttackMap` import (and
  // its bound react-simple-maps mocks) that the tests above rely on.
  it("renders with the real react-simple-maps Geographies/ComposableMap without throwing (smoke test for a projection missing .stream/.invert)", async () => {
    vi.resetModules();
    vi.doUnmock("react-simple-maps");

    const { render: freshRender } = await import("@testing-library/react");
    const { AttackMap: FreshAttackMap } = await import("./AttackMap");

    expect(() =>
      freshRender(<FreshAttackMap heatPoints={POINTS} destination={null} arrivingPoints={[]} />)
    ).not.toThrow();
  });
});
