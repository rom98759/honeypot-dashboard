import { describe, expect, it } from "vitest";
import { countryLabel, flagEmoji, formatAxisNumber, formatDuration, formatLongNumber, percentChange } from "./format";

describe("format", () => {
  it("abbreviates long numbers like Umami", () => {
    expect(formatLongNumber(999)).toBe("999");
    expect(formatLongNumber(3410)).toBe("3.41k");
    expect(formatLongNumber(12_345)).toBe("12.3k");
    expect(formatLongNumber(123_456)).toBe("123k");
    expect(formatLongNumber(2_500_000)).toBe("2.5m");
  });

  it("drops trailing zeros on axis ticks", () => {
    expect(formatAxisNumber(9000)).toBe("9k");
    expect(formatAxisNumber(2500)).toBe("2.5k");
    expect(formatAxisNumber(3410)).toBe("3.41k");
    expect(formatAxisNumber(450)).toBe("450");
  });

  it("formats durations as h/m/s", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(38_000)).toBe("38s");
    expect(formatDuration(67_000)).toBe("1m 7s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  it("computes the change against the previous period", () => {
    expect(percentChange(12, 6)).toBe(100);
    expect(percentChange(3, 6)).toBe(-50);
    expect(percentChange(5, 0)).toBe(100);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, null)).toBeNull();
  });

  it("names countries in French and falls back to the raw name", () => {
    expect(countryLabel("CN", "China")).toBe("Chine");
    expect(countryLabel(null, "Atlantis")).toBe("Atlantis");
    expect(countryLabel(null, null)).toBe("Inconnu");
  });

  it("builds flag emoji from ISO codes", () => {
    expect(flagEmoji("fr")).toBe("🇫🇷");
    expect(flagEmoji(null)).toBe("🏳");
  });
});
