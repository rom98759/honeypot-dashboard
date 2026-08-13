import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "./test-utils";
import App from "./App";

describe("App", () => {
  it("redirects the default route to Overview", async () => {
    renderWithProviders(<App />, { route: "/" });
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Overview").closest("a")).toHaveClass("active"));
  });

  it("renders the Sessions page when navigating there", async () => {
    renderWithProviders(<App />, { route: "/sessions" });
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Sessions").closest("a")).toHaveClass("active"));
    expect(screen.getByText("Sessions page")).toBeInTheDocument();
  });
});
