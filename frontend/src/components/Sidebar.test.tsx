import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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
    expect(screen.getByText("Vue d'ensemble").closest("a")).not.toHaveClass("active");
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

  it("navigates to the IP detail page when an IPv4 address is submitted", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Routes>
            <Route path="/overview" element={<Sidebar />} />
            <Route path="/ip/:ip" element={<div>IP detail stub</div>} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    );
    await userEvent.type(screen.getByPlaceholderText("IP ou session..."), "1.2.3.4{Enter}");
    expect(await screen.findByText("IP detail stub")).toBeInTheDocument();
  });

  it("navigates to the sessions page filtered by session id when a non-IP value is submitted", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Routes>
            <Route path="/overview" element={<Sidebar />} />
            <Route path="/sessions" element={<div>Sessions stub</div>} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    );
    await userEvent.type(screen.getByPlaceholderText("IP ou session..."), "abc123session{Enter}");
    expect(await screen.findByText("Sessions stub")).toBeInTheDocument();
  });

  it("does not navigate when the search is submitted empty or whitespace-only", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Routes>
            <Route path="/overview" element={<Sidebar />} />
            <Route path="/sessions" element={<div>Sessions stub</div>} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    );
    await userEvent.type(screen.getByPlaceholderText("IP ou session..."), "   {Enter}");
    expect(screen.queryByText("Sessions stub")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("IP ou session...")).toBeInTheDocument();
  });
});
