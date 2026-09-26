import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProportionList } from "./ProportionList";

describe("ProportionList", () => {
  it("renders a row per item with a bar width proportional to the max", () => {
    const { container } = render(
      <ProportionList
        items={[
          { label: "France", n: 10 },
          { label: "USA", n: 5 },
        ]}
      />
    );
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    const fills = container.querySelectorAll(".proportion-fill");
    expect(fills[0]).toHaveStyle({ width: "100%" });
    expect(fills[1]).toHaveStyle({ width: "50%" });
  });

  it("renders labels as links built by linkTo when linkTo is set", () => {
    render(
      <MemoryRouter>
        <ProportionList items={[{ label: "France", n: 3 }]} linkTo={(item) => `/sessions?country=${item.label}`} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "France" })).toHaveAttribute("href", "/sessions?country=France");
  });

  it("renders plain text (no link) when linkTo is not set", () => {
    render(<ProportionList items={[{ label: "France", n: 3 }]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("France")).toBeInTheDocument();
  });
});
