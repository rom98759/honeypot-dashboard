import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="Aucune donnée" />);
    expect(screen.getByText("Aucune donnée")).toBeInTheDocument();
  });
});
