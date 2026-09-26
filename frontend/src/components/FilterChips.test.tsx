import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";

describe("FilterChips", () => {
  it("renders nothing when there are no chips", () => {
    const { container } = render(<FilterChips chips={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per entry and calls its own onClear when its button is clicked", async () => {
    const clearA = vi.fn();
    const clearB = vi.fn();
    render(
      <FilterChips
        chips={[
          { label: "Protocole : ssh", onClear: clearA },
          { label: "Pays : France", onClear: clearB },
        ]}
      />
    );
    expect(screen.getByText("Protocole : ssh")).toBeInTheDocument();
    expect(screen.getByText("Pays : France")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Protocole : ssh/ }));
    expect(clearA).toHaveBeenCalledTimes(1);
    expect(clearB).not.toHaveBeenCalled();
  });
});
