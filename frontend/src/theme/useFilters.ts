import { useSearchParams } from "react-router-dom";
import type { OverviewPeriod } from "../api/types";
import { usePeriod } from "./PeriodContext";

/** Period switch that also writes ?period=, which PeriodContext reads first on reload. */
export function useChangePeriod(): (period: OverviewPeriod) => void {
  const [, setSearchParams] = useSearchParams();
  const [, setPeriod] = usePeriod();
  return (period) => {
    setPeriod(period);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("period", period);
      return next;
    });
  };
}
