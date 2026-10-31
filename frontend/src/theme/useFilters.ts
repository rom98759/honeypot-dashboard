import { useSearchParams } from "react-router-dom";
import type { FilterKey, Filters, OverviewPeriod } from "../api/types";
import { usePeriod } from "./PeriodContext";

export const FILTER_KEYS: FilterKey[] = ["country", "protocol", "ip", "username"];

export const FILTER_LABELS: Record<FilterKey, string> = {
  country: "Pays",
  protocol: "Protocole",
  ip: "IP",
  username: "Utilisateur",
};

// Filters live in the URL so a filtered view can be bookmarked or shared, like Umami's.
export function useFilters(): {
  filters: Filters;
  setFilter: (key: FilterKey, value: string) => void;
  removeFilter: (key: FilterKey) => void;
  changePeriod: (period: OverviewPeriod) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const [, setPeriod] = usePeriod();
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = searchParams.get(key);
    if (value) filters[key] = value;
  }

  function update(mutate: (params: URLSearchParams) => void) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      mutate(next);
      return next;
    });
  }

  return {
    filters,
    setFilter: (key, value) => update((p) => p.set(key, value)),
    removeFilter: (key) => update((p) => p.delete(key)),
    // Keep ?period= in sync too: PeriodContext reads it first on reload.
    changePeriod: (period) => {
      setPeriod(period);
      update((p) => p.set("period", period));
    },
  };
}
