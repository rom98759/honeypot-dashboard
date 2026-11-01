import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-utils";
import { HealthBanner } from "./HealthBanner";
import type { HealthSource } from "../api/types";

function source(overrides: Partial<HealthSource>): HealthSource {
  return {
    source: "fail2ban.log",
    path: "/var/log/honeypot-export/fail2ban.log",
    file_present: true,
    file_size: 100,
    ingested_offset: 100,
    lag_bytes: 0,
    last_event: "2026-10-03T00:03:19.852Z",
    stalled: false,
    ...overrides,
  };
}

function mockHealth(sources: HealthSource[]) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sources }), { status: 200 })
  );
}

describe("HealthBanner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when every source is read", async () => {
    mockHealth([source({}), source({ source: "sshd-auth.log" })]);
    const { container } = renderWithProviders(<HealthBanner />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("names stalled and missing sources", async () => {
    mockHealth([
      source({ stalled: true, lag_bytes: 2048 }),
      source({ source: "sshd-auth.log", file_present: false, stalled: true, lag_bytes: null }),
      source({ source: "cowrie.json" }),
    ]);
    renderWithProviders(<HealthBanner />);

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("fail2ban.log : 2 Ko non lus");
    expect(banner).toHaveTextContent("sshd-auth.log : fichier introuvable");
    expect(banner).not.toHaveTextContent("cowrie.json");
  });
});
