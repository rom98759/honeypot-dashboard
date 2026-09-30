import { useEffect, useRef, useState } from "react";
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

interface ZoomState {
  coordinates: [number, number];
  zoom: number;
}

const DEFAULT_ZOOM_STATE: ZoomState = { coordinates: [0, 0], zoom: 1 };

// react-simple-maps' ZoomableGroup only hands `onMoveStart`/`onMoveEnd` a pre-computed
// `{ coordinates, zoom }`. Mid-gesture, `onMove` instead reports the raw d3-zoom transform
// (`{ x, y, zoom, dragging }` — screen-pixel translate + scale), because recomputing the
// inverse projection on every pointermove would be wasteful for its own internal state.
// We need the same lon/lat center for our canvas re-projection, so this mirrors
// react-simple-maps' own internal `getCoords` + `projection.invert` (see its source,
// ZoomableGroup's `handleZoomEnd`) to recover it from the transform onMove gives us.
function zoomStateFromTransform(position: { x: number; y: number; zoom: number }): ZoomState {
  const k = position.zoom;
  const xOffset = (WIDTH * k - WIDTH) / 2;
  const yOffset = (HEIGHT * k - HEIGHT) / 2;
  const pixel: [number, number] = [WIDTH / 2 - (xOffset + position.x) / k, HEIGHT / 2 - (yOffset + position.y) / k];
  const coordinates = (projection.invert?.(pixel) ?? [0, 0]) as [number, number];
  return { coordinates, zoom: k };
}

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
  const [zoomState, setZoomState] = useState<ZoomState>(DEFAULT_ZOOM_STATE);

  function project(longitude: number, latitude: number): [number, number] {
    const base = projection([longitude, latitude]) ?? [0, 0];
    const center = projection(zoomState.coordinates) ?? [WIDTH / 2, HEIGHT / 2];
    const k = zoomState.zoom;
    return [(base[0] - center[0]) * k + WIDTH / 2, (base[1] - center[1]) * k + HEIGHT / 2];
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
  }, [heatPoints, zoomState]);

  const arrivingKeys = new Set(arrivingPoints.map(pointKey));

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <ComposableMap projection={() => projection} width={WIDTH} height={HEIGHT}>
        <ZoomableGroup
          center={zoomState.coordinates}
          zoom={zoomState.zoom}
          onMove={(position) => setZoomState(zoomStateFromTransform(position))}
          onMoveEnd={(position) => setZoomState({ coordinates: position.coordinates, zoom: position.zoom })}
        >
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
            ? arrivingPoints
                .filter((p) => arrivingKeys.has(pointKey(p)))
                .map((p) => (
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
