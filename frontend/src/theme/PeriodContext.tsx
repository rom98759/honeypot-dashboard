import { createContext, useContext, useState, type ReactNode } from "react";

export type Period = "24h" | "7d" | "30d" | "all";

const STORAGE_KEY = "period";
const VALID_PERIODS: Period[] = ["24h", "7d", "30d", "all"];

function isPeriod(value: string | null): value is Period {
  return VALID_PERIODS.includes(value as Period);
}

function getInitialPeriod(): Period {
  // HashRouter puts the query string after the '#', not in window.location.search
  const fromUrl = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("period");
  if (isPeriod(fromUrl)) return fromUrl;
  const stored = localStorage.getItem(STORAGE_KEY);
  return isPeriod(stored) ? stored : "24h";
}

const PeriodContext = createContext<[Period, (p: Period) => void] | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriodState] = useState<Period>(getInitialPeriod);

  function setPeriod(next: Period) {
    setPeriodState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return <PeriodContext.Provider value={[period, setPeriod]}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): [Period, (p: Period) => void] {
  const value = useContext(PeriodContext);
  if (!value) throw new Error("usePeriod must be used within a PeriodProvider");
  return value;
}
