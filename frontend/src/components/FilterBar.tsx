import { useEffect, useRef, useState, type FormEvent } from "react";
import { ListFilter, X } from "lucide-react";
import type { FilterKey, Filters } from "../api/types";
import { FILTER_KEYS, FILTER_LABELS } from "../theme/useFilters";

export function FilterButton({
  suggestions,
  onAdd,
}: {
  suggestions: Partial<Record<FilterKey, string[]>>;
  onAdd: (key: FilterKey, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FilterKey>("country");
  const [value, setValue] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(field, trimmed);
    setValue("");
    setOpen(false);
  }

  return (
    <div className="filter-wrap" ref={wrapRef}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ListFilter />
        Filtre
      </button>
      {open && (
        <form className="filter-popover" onSubmit={submit} aria-label="Ajouter un filtre">
          <h4>Ajouter un filtre</h4>
          <label>
            Champ
            <select className="select" value={field} onChange={(e) => setField(e.target.value as FilterKey)}>
              {FILTER_KEYS.map((k) => (
                <option key={k} value={k}>
                  {FILTER_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valeur
            <input
              className="input"
              list={`filter-suggestions-${field}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="est égal à…"
              autoFocus
            />
            <datalist id={`filter-suggestions-${field}`}>
              {(suggestions[field] ?? []).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div className="actions">
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              Ajouter
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ActiveFilters({
  filters,
  onRemove,
  labelFor,
}: {
  filters: Filters;
  onRemove: (key: FilterKey) => void;
  labelFor?: (key: FilterKey, value: string) => string;
}) {
  const entries = FILTER_KEYS.filter((k) => filters[k]);
  if (!entries.length) return null;
  return (
    <div className="filter-chips">
      {entries.map((key) => (
        <span key={key} className="filter-chip">
          <b>{FILTER_LABELS[key]}</b>
          <span className="op">est</span>
          <span>{labelFor ? labelFor(key, filters[key]!) : filters[key]}</span>
          <button className="btn-icon" onClick={() => onRemove(key)} aria-label={`Retirer le filtre ${FILTER_LABELS[key]}`}>
            <X />
          </button>
        </span>
      ))}
    </div>
  );
}
