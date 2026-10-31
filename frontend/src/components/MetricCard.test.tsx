import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangeLabel, MetricCard } from "./MetricCard";

describe("MetricCard", () => {
  it("renders label, value and no change chip without a previous value", () => {
    render(<MetricCard label="Connexions" value="12" />);
    expect(screen.getByText("Connexions")).toBeInTheDocument();
    expect(screen.queryByTestId("change-label")).toBeNull();
  });

  it("colors rises green by default and red when reversed", () => {
    const { rerender } = render(<ChangeLabel change={14.4} />);
    expect(screen.getByTestId("change-label")).toHaveClass("positive");
    expect(screen.getByTestId("change-label")).toHaveTextContent("14%");
    rerender(<ChangeLabel change={14.4} reverseColors />);
    expect(screen.getByTestId("change-label")).toHaveClass("negative");
    rerender(<ChangeLabel change={0.2} />);
    expect(screen.getByTestId("change-label")).toHaveClass("neutral");
  });
});
