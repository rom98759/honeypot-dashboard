import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../theme/ThemeContext";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("marks the current page's nav item active and leaves the others inactive", () => {
    render(
      <MemoryRouter initialEntries={["/sessions"]}>
        <ThemeProvider>
          <Sidebar />
        </ThemeProvider>
      </MemoryRouter>
    );
    expect(screen.getByText("Sessions").closest("a")).toHaveClass("active");
    expect(screen.getByText("Overview").closest("a")).not.toHaveClass("active");
    expect(screen.getByText("Carte").closest("a")).not.toHaveClass("active");
  });

  it("toggles the theme when the theme button is clicked", async () => {
    localStorage.clear();
    render(
      <MemoryRouter>
        <ThemeProvider>
          <Sidebar />
        </ThemeProvider>
      </MemoryRouter>
    );
    const toggle = screen.getByRole("button", { name: /th.me/i });
    await userEvent.click(toggle);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
});
