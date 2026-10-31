import { describe, expect, it } from "vitest";
import { countryFill } from "./chartTheme";

describe("countryFill", () => {
  it("is the pure primary at 100% and 40 points lighter at 0% in light mode", () => {
    expect(countryFill(100, "light")).toBe("hsl(212.6 82.6% 53.5%)");
    expect(countryFill(0, "light")).toBe("hsl(212.6 82.6% 93.5%)");
  });

  it("darkens instead in dark mode", () => {
    expect(countryFill(0, "dark")).toBe("hsl(212.6 82.6% 13.5%)");
    expect(countryFill(50, "dark")).toBe("hsl(212.6 82.6% 33.5%)");
  });
});
