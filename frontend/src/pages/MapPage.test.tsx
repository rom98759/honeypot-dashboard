import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderWithProviders } from "../test-utils";
import { ThemeProvider } from "../theme/ThemeContext";
import { MapPage } from "./MapPage";

vi.mock("../components/WorldMap", () => ({
  WorldMap: ({
    countries,
    onCountryClick,
  }: {
    countries: { country: string }[];
    onCountryClick?: (c: { country: string }) => void;
  }) => (
    <div data-testid="world-map-stub">
      {countries.length} countries
      <button onClick={() => onCountryClick?.(countries[0])}>Simulate country click</button>
    </div>
  ),
}));

const OVERVIEW = {
  countries: [
    { country: "China", country_code: "CN", n: 30 },
    { country: "United States", country_code: "US", n: 10 },
  ],
  protocol_split: [{ protocol: "ssh", n: 40 }],
};

function stubFetch(fail = false) {
  const mock = vi.fn(() =>
    Promise.resolve(
      fail
        ? ({ ok: false, status: 500 } as Response)
        : ({ ok: true, json: () => Promise.resolve(OVERVIEW) } as Response)
    )
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

const render = () =>
  renderWithProviders(
    <ThemeProvider>
      <MapPage />
    </ThemeProvider>,
    { route: "/map" }
  );

describe("MapPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the choropleth and the country list with shares", async () => {
    stubFetch();
    render();
    expect(await screen.findByText("2 countries")).toBeInTheDocument();
    expect(screen.getByText("Chine")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("2 pays")).toBeInTheDocument();
  });

  it("refetches when the period changes", async () => {
    const fetchMock = stubFetch();
    render();
    await screen.findByText("2 countries");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Période" }), "30d");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=30d"));
  });

  it("filters on a country clicked on the map", async () => {
    const fetchMock = stubFetch();
    render();
    await userEvent.click(await screen.findByRole("button", { name: "Simulate country click" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/overview?period=24h&country=China")
    );
  });

  it("shows an error state when loading fails", async () => {
    stubFetch(true);
    render();
    expect(await screen.findByText("Erreur de chargement, réessaie.")).toBeInTheDocument();
  });
});
