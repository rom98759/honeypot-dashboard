import { describe, expect, it, vi, afterEach } from "vitest";
import { formatTimestamp } from "./formatDate";

describe("formatTimestamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only the time when the timestamp is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T18:00:00Z"));

    const result = formatTimestamp("2026-08-14T10:18:44.673383Z");

    expect(result).not.toMatch(/2026/);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("shows date and time when the timestamp is not today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T18:00:00Z"));

    const result = formatTimestamp("2026-08-14T10:18:44.673383Z");

    expect(result).toMatch(/2026/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("parses fail2ban's raw log timestamp format (space + comma-decimal) instead of returning Invalid Date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T18:00:00Z"));

    const result = formatTimestamp("2026-08-12 09:44:38,400");

    expect(result).not.toMatch(/Invalid Date/);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
