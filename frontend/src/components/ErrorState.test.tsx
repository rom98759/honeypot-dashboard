import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("shows the message and calls onRetry when clicked", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Erreur de chargement, réessaie." onRetry={onRetry} />);
    expect(screen.getByText("Erreur de chargement, réessaie.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
