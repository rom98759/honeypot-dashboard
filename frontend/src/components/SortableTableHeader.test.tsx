import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SortableTableHeader } from "./SortableTableHeader";

const COLUMNS = [
  { key: "src_ip", label: "IP" },
  { key: "connect_time", label: "Début" },
];

describe("SortableTableHeader", () => {
  it("renders a header button per column and calls onSort with the column key", async () => {
    const onSort = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortableTableHeader columns={COLUMNS} sort="src_ip" order="asc" onSort={onSort} />
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByRole("button", { name: /IP/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Début/ }));
    expect(onSort).toHaveBeenCalledWith("connect_time");
  });
});
