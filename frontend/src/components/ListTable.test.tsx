import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListTable } from "./ListTable";

describe("ListTable", () => {
  it("shows abbreviated values and each row's share of the total", () => {
    render(
      <ListTable
        title="Pays"
        metric="Sessions"
        rows={[
          { key: "a", label: "A", value: 3410 },
          { key: "b", label: "B", value: 1090 },
        ]}
      />
    );
    expect(screen.getByText("3.41k")).toHaveAttribute("title", "3 410".replace(" ", " "));
    expect(screen.getByText("76%")).toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
  });

  it("computes shares against the real total when one is given", () => {
    render(
      <ListTable
        title="Identifiants"
        metric="Tentatives"
        total={140686}
        rows={[
          { key: "a", label: "A", value: 1638 },
          { key: "b", label: "B", value: 400 },
        ]}
      />
    );
    expect(screen.getByText("1.2%")).toBeInTheDocument();
    expect(screen.getByText("<1%")).toBeInTheDocument();
  });

  it("makes rows with a handler keyboard-activable buttons", async () => {
    const onClick = vi.fn();
    render(<ListTable title="T" metric="M" rows={[{ key: "a", label: "A", value: 1, onClick }]} />);
    const row = screen.getByRole("button", { name: /A/ });
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state without rows", () => {
    render(<ListTable title="T" metric="M" rows={[]} />);
    expect(screen.getByText("Aucune donnée")).toBeInTheDocument();
  });
});
