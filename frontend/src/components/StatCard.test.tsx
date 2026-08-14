import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("renders the label and value", () => {
    render(<StatCard label="Connexions" value={42} />);
    expect(screen.getByText("Connexions")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("applies the danger class when danger is true", () => {
    const { container } = render(<StatCard label="Actuellement banni" value={3} danger />);
    expect(container.querySelector(".card")).toHaveClass("card-danger");
  });

  it("renders a string value", () => {
    render(<StatCard label="Localisation" value="Paris, France" />);
    expect(screen.getByText("Paris, France")).toBeInTheDocument();
  });
});
