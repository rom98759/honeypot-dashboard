import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { PeriodProvider, usePeriod } from "./PeriodContext";

function renderPeriod() {
  return renderHook(() => usePeriod(), { wrapper: PeriodProvider });
}

describe("PeriodContext", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults to 24h when nothing is stored", () => {
    const { result } = renderPeriod();
    expect(result.current[0]).toBe("24h");
  });

  it("restores a persisted period", () => {
    localStorage.setItem("period", "7d");
    const { result } = renderPeriod();
    expect(result.current[0]).toBe("7d");
  });

  it("ignores a garbage stored value and falls back to 24h", () => {
    localStorage.setItem("period", "not-a-period");
    const { result } = renderPeriod();
    expect(result.current[0]).toBe("24h");
  });

  it("setPeriod updates state and persists", () => {
    const { result } = renderPeriod();
    act(() => result.current[1]("30d"));
    expect(result.current[0]).toBe("30d");
    expect(localStorage.getItem("period")).toBe("30d");
  });

  it("shares the same period across two consumers under one provider", () => {
    let second: ReturnType<typeof usePeriod> | undefined;
    function Second() {
      second = usePeriod();
      return null;
    }
    const { result } = renderHook(
      () => {
        const first = usePeriod();
        return first;
      },
      { wrapper: ({ children }) => <PeriodProvider>{children}<Second /></PeriodProvider> }
    );
    act(() => result.current[1]("all"));
    expect(second?.[0]).toBe("all");
  });
});
