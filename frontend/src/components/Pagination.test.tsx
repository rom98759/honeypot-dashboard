import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("disables Précédent on the first page and Suivant on the last page", () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();

    rerender(<Pagination page={3} totalPages={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("calls onPrev/onNext when clicked", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Pagination page={2} totalPages={3} onPrev={onPrev} onNext={onNext} />);
    await userEvent.click(screen.getByRole("button", { name: "Précédent" }));
    await userEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
