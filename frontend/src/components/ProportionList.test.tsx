import { render, screen } from "@testing-library/react";
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
});
