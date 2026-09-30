import { describe, expect, it } from "vitest";
import { aggregateMapEvents, pointKey } from "./mapAggregation";
import type { MapEvent } from "../api/types";

function event(overrides: Partial<MapEvent>): MapEvent {
  return {
    ip: "1.2.3.4",
    city: "Paris",
    country: "France",
    latitude: 48.85,
    longitude: 2.35,
    connect_time: "2026-08-14T10:00:00Z",
    ...overrides,
  };
}

describe("pointKey", () => {
  it("builds a key from latitude and longitude", () => {
    expect(pointKey({ latitude: 48.85, longitude: 2.35 })).toBe("48.85,2.35");
  });
});

describe("aggregateMapEvents", () => {
  it("groups events at the same coordinate into one point with the right count", () => {
    const events = [event({ ip: "1.2.3.4" }), event({ ip: "5.6.7.8" })];
    const points = aggregateMapEvents(events, null);
    expect(points).toEqual([{ latitude: 48.85, longitude: 2.35, count: 2 }]);
  });

  it("keeps separate coordinates as separate points", () => {
    const events = [
      event({ latitude: 48.85, longitude: 2.35 }),
      event({ latitude: 52.52, longitude: 13.4 }),
    ];
    const points = aggregateMapEvents(events, null);
    expect(points).toHaveLength(2);
  });

  it("with cutoff=null, includes every event", () => {
    const events = [event({ connect_time: "2026-08-14T10:00:00Z" })];
    expect(aggregateMapEvents(events, null)[0].count).toBe(1);
  });

  it("excludes events strictly after the cutoff", () => {
    const events = [
      event({ connect_time: "2026-08-14T09:00:00Z" }),
      event({ connect_time: "2026-08-14T11:00:00Z" }),
    ];
    const points = aggregateMapEvents(events, "2026-08-14T10:00:00Z");
    expect(points[0].count).toBe(1);
  });

  it("includes an event exactly at the cutoff (inclusive boundary)", () => {
    const events = [event({ connect_time: "2026-08-14T10:00:00Z" })];
    const points = aggregateMapEvents(events, "2026-08-14T10:00:00Z");
    expect(points[0].count).toBe(1);
  });

  it("returns an empty array for empty input", () => {
    expect(aggregateMapEvents([], null)).toEqual([]);
  });
});
