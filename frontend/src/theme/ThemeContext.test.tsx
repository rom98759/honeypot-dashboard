import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function renderTheme() {
  return renderHook(() => useTheme(), { wrapper: ThemeProvider });
}

describe("ThemeContext", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to light when localStorage is empty and the OS prefers light", () => {
    const { result } = renderTheme();
    expect(result.current[0]).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("defaults to dark when localStorage is empty and the OS prefers dark", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as typeof window.matchMedia;

    const { result } = renderTheme();
    expect(result.current[0]).toBe("dark");

    window.matchMedia = original;
  });

  it("restores a persisted theme over the OS preference", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderTheme();
    expect(result.current[0]).toBe("dark");
  });

  it("toggleTheme flips the theme, persists it, and updates the DOM attribute", () => {
    const { result } = renderTheme();
    act(() => result.current[1]());
    expect(result.current[0]).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    act(() => result.current[1]());
    expect(result.current[0]).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
