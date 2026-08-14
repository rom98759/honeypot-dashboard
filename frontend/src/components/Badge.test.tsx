import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders the label with a tone-specific class", () => {
    render(<Badge label="Banni" tone="danger" />);
    expect(screen.getByText("Banni")).toHaveClass("badge", "badge-danger");
  });

  it("renders the success tone", () => {
    render(<Badge label="Unban" tone="success" />);
    expect(screen.getByText("Unban")).toHaveClass("badge", "badge-success");
  });
});
