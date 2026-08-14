import { ComposableMap, Geographies, Geography, Marker, Line } from "react-simple-maps";
import worldAtlas from "world-atlas/countries-110m.json";
import type { MapDestination, MapPoint } from "../api/types";

const MIN_RADIUS = 4;
const MAX_RADIUS = 14;

function radiusFor(sessionCount: number, maxSessionCount: number): number {
  if (maxSessionCount <= 0) return MIN_RADIUS;
  const ratio = sessionCount / maxSessionCount;
  return MIN_RADIUS + ratio * (MAX_RADIUS - MIN_RADIUS);
}

function pointKey(point: { latitude: number; longitude: number }): string {
  return `${point.latitude},${point.longitude}`;
}

export function AttackMap({
  points,
  destination,
  arrivingKeys,
  onPointClick,
}: {
  points: MapPoint[];
  destination: MapDestination | null;
  arrivingKeys: Set<string>;
  onPointClick: (point: MapPoint) => void;
}) {
  const maxSessionCount = Math.max(...points.map((p) => p.session_count), 1);

  return (
    <ComposableMap projectionConfig={{ scale: 140 }}>
      <Geographies geography={worldAtlas}>
        {({ geographies }) =>
          geographies.map((geo) => (
            <Geography
              key={geo.rsmKey}
              geography={geo}
              fill="var(--neutral-subtle)"
              stroke="var(--border)"
              style={{
                default: { outline: "none" },
                hover: { outline: "none" },
                pressed: { outline: "none" },
              }}
            />
          ))
        }
      </Geographies>
      {destination
        ? points
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
      {points.map((point) => (
        <Marker key={pointKey(point)} coordinates={[point.longitude, point.latitude]} onClick={() => onPointClick(point)}>
          <circle
            className="map-marker"
            r={radiusFor(point.session_count, maxSessionCount)}
            fill="var(--accent)"
            fillOpacity={0.7}
            stroke="var(--accent)"
          />
        </Marker>
      ))}
    </ComposableMap>
  );
}
