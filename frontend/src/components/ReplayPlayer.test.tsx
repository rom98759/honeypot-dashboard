import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayPlayer } from "./ReplayPlayer";

describe("ReplayPlayer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downloads the recording once and hands the data to the player", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve("CAST") } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const create = vi.fn(() => ({ dispose: vi.fn() }));
    vi.stubGlobal("AsciinemaPlayer", { create });

    render(<ReplayPlayer sessionId="s1" />);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/s1/replay");
    expect(create).toHaveBeenCalledWith({ data: "CAST" }, expect.any(HTMLElement));
  });

  it("shows a message when the replay is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404 } as Response)));
    vi.stubGlobal("AsciinemaPlayer", { create: vi.fn() });

    render(<ReplayPlayer sessionId="s1" />);

    expect(await screen.findByText("Replay indisponible pour cette session.")).toBeInTheDocument();
  });
});
