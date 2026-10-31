// Values from Umami's THEME_COLORS: chart text/grid greys and the map fill differ per theme,
// the primary blue does not.
export const PRIMARY = "#2680eb";

const THEMES = {
  light: { text: "#838383", line: "#d9d9d9", fill: "#f9f9f9" },
  dark: { text: "#7b7b7b", line: "#3a3a3a", fill: "#262626" },
} as const;

export function chartTheme(theme: "light" | "dark") {
  return THEMES[theme];
}

export function primaryAlpha(alpha: number): string {
  return `rgba(38, 128, 235, ${alpha})`;
}

// #2680eb in HSL. Umami lightens (light theme) or darkens (dark theme) the primary by
// 0.4 * (1 - share), so a country with 100% of the traffic gets the pure primary.
const H = 212.6;
const S = 82.6;
const L = 53.5;

export function countryFill(sharePercent: number, theme: "light" | "dark"): string {
  const amount = 40 * (1 - Math.min(100, Math.max(0, sharePercent)) / 100);
  const lightness = theme === "light" ? Math.min(100, L + amount) : Math.max(0, L - amount);
  return `hsl(${H} ${S}% ${lightness.toFixed(1)}%)`;
}
