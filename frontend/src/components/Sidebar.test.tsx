import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("marks the current page's nav item active and leaves the others inactive", () => {
    render(
      <MemoryRouter initialEntries={["/sessions"]}>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.getByText("Sessions").closest("a")).toHaveClass("active");
    expect(screen.getByText("Overview").closest("a")).not.toHaveClass("active");
    expect(screen.getByText("Carte").closest("a")).not.toHaveClass("active");
  });
});
