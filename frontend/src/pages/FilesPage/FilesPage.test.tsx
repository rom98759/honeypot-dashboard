import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import { FilesPage } from "./FilesPage";
import type { FileDetail, FileList } from "../../api/types";

const SHA = "c".repeat(64);

const LIST: FileList = {
  items: [
    {
      shasum: SHA,
      name: "http://198.51.100.7/x86",
      kinds: ["download", "upload"],
      events: 40,
      sessions: 31,
      ips: 12,
      first_seen: "2026-09-01T00:00:00Z",
      last_seen: "2026-11-04T12:00:00Z",
      size: 3 * 1024 * 1024,
    },
  ],
  total: 1,
  totals: { files: 124, events: 5294, new_7d: 3, failed: 142 },
};

const DETAIL: FileDetail = {
  shasum: SHA,
  size: null,
  events: 40,
  sessions: 31,
  ips: 12,
  first_seen: "2026-09-01T00:00:00Z",
  last_seen: "2026-11-04T12:00:00Z",
  kinds: ["download"],
  sources: [{ kind: "download", url: "http://198.51.100.7/x86", filename: "", events: 40 }],
  recent_events: [
    { session_id: "s9", src_ip: "203.0.113.5", timestamp: "2026-11-04T12:00:00Z", kind: "download", url: "", filename: "" },
  ],
  top_ips: [{ ip: "203.0.113.5", sessions: 20 }],
};

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe("FilesPage", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) => jsonResponse(url.startsWith("/api/files?") ? LIST : DETAIL));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows totals and one row per distinct file", async () => {
    renderWithProviders(<FilesPage />, { route: "/files" });
    expect(await screen.findByText("124")).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "http://198.51.100.7/x86" }).closest("tr")!;
    expect(within(row).getByText("Téléchargé")).toBeInTheDocument();
    expect(within(row).getByText("Déposé")).toBeInTheDocument();
    expect(within(row).getByText("3,0 Mo")).toBeInTheDocument();
    expect(within(row).getByText("31")).toBeInTheDocument();
  });

  it("sorts through the tabs", async () => {
    renderWithProviders(<FilesPage />, { route: "/files" });
    await screen.findByText("124");
    await userEvent.click(screen.getByRole("tab", { name: "Nouveaux" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("sort=first_seen"));
  });

  it("opens the file panel with its hash and no zip when Cowrie kept no copy", async () => {
    renderWithProviders(<FilesPage />, { route: `/files?file=${SHA}` });
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText(SHA)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /VirusTotal/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: /Zip/ })).toBeNull();
    expect(within(panel).getByText(/pas gardé de copie/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "s9" })).toHaveAttribute("href", `/files?file=${SHA}&session=s9`);
  });
});
