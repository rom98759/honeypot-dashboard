import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttackMap } from "./AttackMap";

const POINTS = [
  { city: "Paris", country: "France", latitude: 48.85, longitude: 2.35, session_count: 5, ips: ["1.2.3.4"] },
  { city: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.4, session_count: 10, ips: ["5.6.7.8"] },
];

describe("AttackMap", () => {
  it("renders one marker per point and calls onPointClick with the right point", () => {
    const onPointClick = vi.fn();
    const { container } = render(
      <AttackMap points={POINTS} destination={null} arrivingKeys={new Set()} onPointClick={onPointClick} />
    );
    const markers = container.querySelectorAll(".map-marker");
    expect(markers).toHaveLength(2);

    fireEvent.click(markers[0]);
    expect(onPointClick).toHaveBeenCalledWith(POINTS[0]);
  });

  it("draws an arrival line only for points in arrivingKeys, and only when a destination is set", () => {
    const { container, rerender } = render(
      <AttackMap
        points={POINTS}
        destination={{ latitude: 51.0162051, longitude: 2.1556627 }}
        arrivingKeys={new Set(["48.85,2.35"])}
        onPointClick={vi.fn()}
      />
    );
    expect(container.querySelectorAll(".attack-line")).toHaveLength(1);

    rerender(
      <AttackMap points={POINTS} destination={null} arrivingKeys={new Set(["48.85,2.35"])} onPointClick={vi.fn()} />
    );
    expect(container.querySelectorAll(".attack-line")).toHaveLength(0);
  });

  it("sizes markers larger for higher session counts", () => {
    const { container } = render(
      <AttackMap points={POINTS} destination={null} arrivingKeys={new Set()} onPointClick={vi.fn()} />
    );
    const markers = container.querySelectorAll(".map-marker");
    const parisRadius = Number(markers[0].getAttribute("r"));
    const berlinRadius = Number(markers[1].getAttribute("r"));
    expect(berlinRadius).toBeGreaterThan(parisRadius);
  });
});
