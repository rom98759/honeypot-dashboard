import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../test-utils";
import { CommandsPage } from "./CommandsPage";
import { COMMANDS_PAGE_SIZE } from "../api/commands";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const COMMANDS_PAGE_1 = {
  items: [
    { input_text: "whoami", n: 12, last_seen: "2026-08-13T10:00:00Z" },
    { input_text: "cat /etc/passwd | grep root", n: 3, last_seen: "2026-08-12T09:00:00Z" },
  ],
  total: 40,
};

describe("CommandsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders ranked command rows from the API", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(COMMANDS_PAGE_1)));
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("whoami")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("cat /etc/passwd | grep root")).toBeInTheDocument();
  });

  it("fetches with the default 24h period", async () => {
    const fetchMock = vi.fn(() => jsonResponse(COMMANDS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("whoami")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/commands?period=24h&limit=${COMMANDS_PAGE_SIZE}&offset=0`
    );
  });

  it("debounces the search box and sends q to the API", async () => {
    const fetchMock = vi.fn(() => jsonResponse(COMMANDS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("whoami")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Filtrer par commande..."), "wget");
    await waitFor(
      () => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("q=wget")),
      { timeout: 1000 }
    );
  });

  it("does not send q when the search box is only whitespace", async () => {
    const fetchMock = vi.fn(() => jsonResponse(COMMANDS_PAGE_1));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("whoami")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Filtrer par commande..."), "   ");
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.not.stringContaining("q=")), {
      timeout: 1000,
    });
  });

  it("links each row to its sessions, URL-encoding special characters", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(COMMANDS_PAGE_1)));
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("whoami")).toBeInTheDocument());
    const links = screen.getAllByRole("link", { name: "Voir les sessions" });
    expect(links[0]).toHaveAttribute("href", "/sessions?command=whoami");
    expect(links[1]).toHaveAttribute(
      "href",
      `/sessions?command=${encodeURIComponent("cat /etc/passwd | grep root")}`
    );
  });

  it("renders an empty state and valid pagination when there are no commands", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ items: [], total: 0 })));
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("Aucune donnée")).toBeInTheDocument());
    expect(screen.getByText("Page 1 / 1")).toBeInTheDocument();
  });

  it("shows an error state and recovers via the retry button", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CommandsPage />, { route: "/commands" });
    await waitFor(() => expect(screen.getByText("Erreur de chargement, réessaie.")).toBeInTheDocument());

    fetchMock.mockImplementationOnce(() => jsonResponse(COMMANDS_PAGE_1));
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("whoami")).toBeInTheDocument());
  });
});
