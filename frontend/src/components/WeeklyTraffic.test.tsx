import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toLocalGrid, WeeklyTraffic } from "./WeeklyTraffic";

describe("WeeklyTraffic", () => {
  it("shifts UTC cells to local time, wrapping across days", () => {
    const grid = toLocalGrid([{ day_of_week: 6, hour: 23, n: 4 }], 120);
    expect(grid[0][1]).toBe(4);
    const west = toLocalGrid([{ day_of_week: 0, hour: 1, n: 2 }], -300);
    expect(west[6][20]).toBe(2);
  });

  it("renders a Monday-first 7x24 grid sized by volume", () => {
    const { container } = render(<WeeklyTraffic cells={[{ day_of_week: 1, hour: 10, n: 5 }]} />);
    expect(screen.getAllByText(/^(lun|mar|mer|jeu|ven|sam|dim)\.$/).map((e) => e.textContent)).toEqual([
      "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim.",
    ]);
    expect(container.querySelectorAll(".weekly-cell")).toHaveLength(168);
    expect(container.querySelector('.weekly-cell[data-count="5"] i')).toHaveStyle({ opacity: "1" });
  });
});
