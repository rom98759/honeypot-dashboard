// frontend/src/components/AttackHeatmap.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttackHeatmap } from "./AttackHeatmap";

describe("AttackHeatmap", () => {
  it("renders 168 cells (7 days x 24 hours)", () => {
    render(<AttackHeatmap cells={[]} />);
    expect(screen.getAllByTestId("heatmap-cell")).toHaveLength(168);
  });

  it("sets a title with the exact count for a populated cell", () => {
    render(<AttackHeatmap cells={[{ day_of_week: 0, hour: 3, n: 5 }]} />);
    const cell = screen.getAllByTestId("heatmap-cell").find((el) => el.title.includes("5 session"));
    expect(cell).toBeDefined();
    expect(cell?.title).toContain("Dim");
    expect(cell?.title).toContain("3h");
  });

  it("gives zero opacity to a cell with no sessions", () => {
    render(<AttackHeatmap cells={[{ day_of_week: 0, hour: 3, n: 5 }]} />);
    const cells = screen.getAllByTestId("heatmap-cell");
    const emptyCell = cells.find((el) => el.title.includes("0 session"));
    expect(emptyCell).toBeDefined();
    expect(emptyCell?.style.opacity).toBe("0");
  });

  it("renders without throwing when cells is empty", () => {
    render(<AttackHeatmap cells={[]} />);
    expect(screen.getAllByTestId("heatmap-cell")).toHaveLength(168);
  });
});
