import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-utils";
import { IpAddress, PROXIED_LABEL } from "./IpAddress";

function mockConfig(proxied: string | null) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sshd_port: null, ban_enabled: false, proxied_source_ip: proxied }), {
      status: 200,
    })
  );
}

describe("IpAddress", () => {
  afterEach(() => vi.restoreAllMocks());

  it("labels the proxied gateway as an unknown IPv6 client", async () => {
    mockConfig("172.21.0.1");
    renderWithProviders(<IpAddress ip="172.21.0.1" />);
    expect(await screen.findByText(PROXIED_LABEL)).toBeInTheDocument();
  });

  it("shows any other address as is", async () => {
    mockConfig("172.21.0.1");
    renderWithProviders(<IpAddress ip="203.0.113.5" />);
    expect(await screen.findByText("203.0.113.5")).toBeInTheDocument();
    expect(screen.queryByText(PROXIED_LABEL)).not.toBeInTheDocument();
  });
});
