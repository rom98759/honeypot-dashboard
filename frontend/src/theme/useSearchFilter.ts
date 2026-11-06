import { useSearchParams } from "react-router-dom";
import { formatSearch, quoteValue, safeParse, type SearchField, type SearchTerm } from "../utils/searchFilter";

// Older links (?ip=, ?country= …) still work: they are read as search terms, and the first
// change rewrites them into ?filter=.
const LEGACY_PARAMS: [string, SearchField][] = [
  ["ip", "ip"],
  ["country", "country"],
  ["protocol", "proto"],
  ["username", "user"],
];

export interface SearchFilterState {
  /** Text sent to the API (may be invalid when typed by hand in the URL). */
  filter: string;
  terms: SearchTerm[];
  /** Client-side syntax error of the URL's filter; such a filter is not sent. */
  error: string | null;
  setFilter: (text: string) => void;
  /** Drill-down from a list: replaces a positive term on the same field. */
  addTerm: (field: SearchField, value: string, negate?: boolean) => void;
  removeTerm: (index: number) => void;
}

export function useSearchFilter(): SearchFilterState {
  const [searchParams, setSearchParams] = useSearchParams();
  const legacy = LEGACY_PARAMS.flatMap(([param, field]) => {
    const value = searchParams.get(param);
    return value ? [`${field}:${quoteValue(value)}`] : [];
  });
  const raw = [searchParams.get("filter") ?? "", ...legacy].map((s) => s.trim()).filter(Boolean).join(" ");
  const { terms, error } = safeParse(raw);

  function setFilter(text: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [param] of LEGACY_PARAMS) next.delete(param);
      if (text.trim()) next.set("filter", text.trim());
      else next.delete("filter");
      next.delete("page");
      return next;
    });
  }

  return {
    filter: error ? "" : formatSearch(terms),
    terms,
    error,
    setFilter,
    addTerm: (field, value, negate = false) => {
      const kept = terms.filter((t) => negate || t.negate || t.field !== field);
      setFilter(formatSearch([...kept, { field, op: ":", values: [value], negate }]));
    },
    removeTerm: (index) => setFilter(formatSearch(terms.filter((_, i) => i !== index))),
  };
}
