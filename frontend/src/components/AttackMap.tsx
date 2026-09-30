import { useCallback, useEffect, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup, Line } from "react-simple-maps";
import { geoEqualEarth, type GeoProjection } from "d3-geo";
import simpleheat from "simpleheat";
import worldAtlas from "world-atlas/countries-110m.json";
import type { MapDestination } from "../api/types";
import type { HeatPoint } from "../utils/mapAggregation";
import { pointKey } from "../utils/mapAggregation";

const WIDTH = 800;
const HEIGHT = 500;
const projection: GeoProjection = geoEqualEarth().scale(140).translate([WIDTH / 2, HEIGHT / 2]);

// Mirrors react-simple-maps' own ZoomableGroup transform: it applies
// `translate(x, y) scale(k)` to its SVG <g> (see its `transformString`, built from the
// raw d3-zoom transform `{x, y, k}`). `onMove` reports that exact same raw transform
// mid-gesture, so the canvas heatmap re-projects points with the identical forward math
// — no lon/lat inversion, and no feeding anything back into ZoomableGroup's controlled
// props (feeding the transform back into ZoomableGroup's controlled center/zoom props
// froze live drags, which is why this component keeps ZoomableGroup uncontrolled).
interface ViewState {
  x: number;
  y: number;
  k: number;
}

const DEFAULT_VIEW_STATE: ViewState = { x: 0, y: 0, k: 1 };

export function AttackMap({
  heatPoints,
  destination,
  arrivingPoints,
}: {
  heatPoints: HeatPoint[];
  destination: MapDestination | null;
  arrivingPoints: HeatPoint[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);

  // Stable identity: ZoomableGroup's internal effect that binds the d3-zoom listeners
  // depends on this prop, so a new function every render would rebind on every render.
  const onMove = useCallback((position: { x: number; y: number; zoom: number }) => {
    setViewState({ x: position.x, y: position.y, k: position.zoom });
  }, []);

  function project(longitude: number, latitude: number): [number, number] {
    const base = projection([longitude, latitude]) ?? [0, 0];
    return [viewState.k * base[0] + viewState.x, viewState.k * base[1] + viewState.y];
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const heat = simpleheat(canvas);
    const maxCount = Math.max(...heatPoints.map((p) => p.count), 1);
    heat.data(heatPoints.map((p) => [...project(p.longitude, p.latitude), p.count]));
    heat.max(maxCount);
    heat.gradient({ 0.25: "#2ecfff", 0.55: "#ffb020", 1: "#ff3b3b" });
    heat.draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatPoints, viewState]);

  return (
    <div style={{ position: "relative", maxWidth: 896, margin: "0 auto" }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      {/*
        react-simple-maps' `ProjectionFunction` type claims `projection` is a factory
        `(width, height, config) => GeoProjection`, but its runtime `makeProjection`
        (dist/index.es.js, `isFunc` branch, ~line 188) treats ANY function prop as the
        projection object itself — verified against the actual installed source, not just
        the types. The previous `projection={() => projection}` handed the library a
        function with no `.stream`/`.invert`, crashing `Geographies`' `geoPath().projection(...)`.
      */}
      {/* @ts-expect-error react-simple-maps' ProjectionFunction type is wrong — it accepts a GeoProjection instance directly, not a factory */}
      <ComposableMap projection={projection} width={WIDTH} height={HEIGHT}>
        <ZoomableGroup onMove={onMove}>{/* uncontrolled: no center/zoom props, see above */}
          <Geographies geography={worldAtlas}>
            {({ geographies }) =>
              geographies.map((geo: object & { rsmKey: string }) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="var(--neutral-subtle)"
                  stroke="var(--border)"
                  style={{ default: { outline: "none" }, hover: { outline: "none" }, pressed: { outline: "none" } }}
                />
              ))
            }
          </Geographies>
          {destination
            ? arrivingPoints.map((p) => (
                <Line
                  key={`line-${pointKey(p)}`}
                  from={[p.longitude, p.latitude]}
                  to={[destination.longitude, destination.latitude]}
                  className="attack-line"
                  stroke="var(--danger)"
                  strokeWidth={1.5}
                />
              ))
            : null}
        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
}
