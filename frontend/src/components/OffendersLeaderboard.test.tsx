import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { OffendersLeaderboard } from "./OffendersLeaderboard";

function renderWithRouter(offenders: Parameters<typeof OffendersLeaderboard>[0]["offenders"]) {
  return render(
    <MemoryRouter>
      <OffendersLeaderboard offenders={offenders} />
    </MemoryRouter>
  );
}

describe("OffendersLeaderboard", () => {
  it("renders IP, country, session count, and last seen for each offender", () => {
    renderWithRouter([
      { src_ip: "1.2.3.4", n: 6, country: "France", last_seen: "2026-08-13T10:00:00Z" },
    ]);
    expect(screen.getByText("1.2.3.4")).toBeInTheDocument();
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("shows an em dash for a null country", () => {
    renderWithRouter([
      { src_ip: "9.9.9.9", n: 1, country: null, last_seen: "2026-08-13T10:00:00Z" },
    ]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("links the IP to its detail page", () => {
    renderWithRouter([
      { src_ip: "1.2.3.4", n: 6, country: "France", last_seen: "2026-08-13T10:00:00Z" },
    ]);
    expect(screen.getByRole("link", { name: "1.2.3.4" })).toHaveAttribute("href", "/ip/1.2.3.4");
  });
});
