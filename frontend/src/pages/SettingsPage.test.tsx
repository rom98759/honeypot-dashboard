import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-utils";
import { SettingsPage } from "./SettingsPage";

const LISTING = {
  items: [{ cidr: "203.0.113.0/24", note: "box", created_at: "2026-11-01T10:00:00Z" }],
  env: ["203.0.113.7/32"],
};

function stub(postStatus = 201) {
  const mock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve({ ok: postStatus < 400, status: postStatus, json: () => Promise.resolve({}) } as Response);
    }
    if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 204 } as Response);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(LISTING) } as Response);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("SettingsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists stored and env-provided protected ranges", async () => {
    stub();
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText("203.0.113.0/24")).toBeInTheDocument();
    expect(screen.getByText("box")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7/32")).toBeInTheDocument();
    expect(screen.getByText(/ADMIN_IPS/)).toBeInTheDocument();
  });

  it("adds a range with its note", async () => {
    const mock = stub();
    renderWithProviders(<SettingsPage />);
    await screen.findByText("203.0.113.0/24");

    await userEvent.type(screen.getByLabelText("IP ou plage"), "198.51.100.7");
    await userEvent.type(screen.getByLabelText("Note"), "4G");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/settings/admin-ips",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ value: "198.51.100.7", note: "4G" }) })
      )
    );
  });

  it("explains a refused range", async () => {
    stub(400);
    renderWithProviders(<SettingsPage />);
    await screen.findByText("203.0.113.0/24");
    await userEvent.type(screen.getByLabelText("IP ou plage"), "0.0.0.0/0");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText(/invalide ou plus large/)).toBeInTheDocument();
  });

  it("removes a stored range", async () => {
    const mock = stub();
    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Retirer 203.0.113.0/24" }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/settings/admin-ips?cidr=203.0.113.0%2F24",
        expect.objectContaining({ method: "DELETE" })
      )
    );
  });
});
