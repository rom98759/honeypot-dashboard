import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleHelp, ListFilter, Search, X } from "lucide-react";
import {
  FIELD_LABELS,
  SEARCH_FIELDS,
  describeTerm,
  formatSearch,
  safeParse,
  type SearchField,
} from "../utils/searchFilter";
import type { SearchFilterState } from "../theme/useSearchFilter";

const PLACEHOLDER = "ip:45.* country:CN,RU -user:root cmd:wget dur>60";

const HELP: [string, string][] = [
  ["ip:45.* ip:10.0.0.0/8", "IP, préfixe ou plage CIDR"],
  ["country:CN,RU", "pays (code ou nom) ; la virgule = OU"],
  ["asn:14061 asn:ovh", "numéro d'AS ou nom de l'opérateur"],
  ["proto:telnet", "ssh ou telnet"],
  ["user:root pass:123*", "identifiants, * = joker"],
  ['cmd:wget cmd:"uname -a"', "commande contenant ce texte"],
  ["dur>60 dur<5m", "durée en secondes, ou m / h"],
  ["login:ok", "ok, failed, none"],
  ["file:any file:upload", "any, download, upload, redirect, failed ou SHA-256"],
  ["-user:root", "le tiret exclut"],
];

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function AddFilter({
  suggestions,
  onAdd,
}: {
  suggestions: Partial<Record<SearchField, string[]>>;
  onAdd: (field: SearchField, value: string, negate: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<SearchField>("country");
  const [negate, setNegate] = useState(false);
  const [value, setValue] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(field, trimmed, negate);
    setValue("");
    setOpen(false);
  }

  return (
    <div className="filter-wrap" ref={ref}>
      <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ListFilter />
        Filtre
      </button>
      {open && (
        <form className="filter-popover" onSubmit={submit} aria-label="Ajouter un filtre">
          <h4>Ajouter un filtre</h4>
          <label>
            Champ
            <select className="select" value={field} onChange={(e) => setField(e.target.value as SearchField)}>
              {SEARCH_FIELDS.filter((f) => f !== "dur").map((f) => (
                <option key={f} value={f}>
                  {FIELD_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Condition
            <select className="select" value={negate ? "not" : "is"} onChange={(e) => setNegate(e.target.value === "not")}>
              <option value="is">{field === "cmd" ? "contient" : "est"}</option>
              <option value="not">{field === "cmd" ? "ne contient pas" : "n'est pas"}</option>
            </select>
          </label>
          <label>
            Valeur
            <input
              className="input"
              list={`filter-suggestions-${field}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
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

/**
 * Full-width search bar driving the URL's ?filter=, its chips below. `serverError` is the
 * API's 400 message, for a filter the client could not catch.
 */
export function QueryBar({
  search,
  suggestions = {},
  serverError,
}: {
  search: SearchFilterState;
  suggestions?: Partial<Record<SearchField, string[]>>;
  serverError?: string | null;
}) {
  const current = search.error ? "" : formatSearch(search.terms);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const helpRef = useDismiss(help, () => setHelp(false));

  // Chips, drill-down clicks and back/forward change the URL: follow it.
  useEffect(() => {
    setText(current);
    setError(null);
  }, [current]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = safeParse(text);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setError(null);
    search.setFilter(formatSearch(parsed.terms));
  }

  const shownError = error ?? search.error ?? serverError ?? null;

  return (
    <div className="query-bar">
      <div className="query-row">
        <form className="query-form" onSubmit={submit} role="search">
          <Search />
          <input
            className="query-input mono"
            aria-label="Requête de recherche"
            aria-invalid={shownError ? true : undefined}
            placeholder={PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
          />
          {text && (
            <button
              type="button"
              className="btn-icon"
              aria-label="Effacer la requête"
              onClick={() => {
                setText("");
                search.setFilter("");
              }}
            >
              <X />
            </button>
          )}
        </form>
        <div className="filter-wrap" ref={helpRef}>
          <button
            type="button"
            className="btn-icon query-help-toggle"
            aria-label="Syntaxe de recherche"
            aria-expanded={help}
            onClick={() => setHelp((h) => !h)}
          >
            <CircleHelp />
          </button>
          {help && (
            <div className="filter-popover query-help" role="dialog" aria-label="Syntaxe de recherche">
              <h4>Syntaxe</h4>
              <dl>
                {HELP.map(([example, meaning]) => (
                  <div key={example}>
                    <dt className="mono">{example}</dt>
                    <dd>{meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="cell-muted">Les conditions s'additionnent (ET). Entrée pour appliquer.</p>
            </div>
          )}
        </div>
        <AddFilter suggestions={suggestions} onAdd={search.addTerm} />
      </div>
      {shownError && (
        <p className="query-error" role="alert">
          {shownError}
        </p>
      )}
      {search.terms.length > 0 && (
        <div className="filter-chips">
          {search.terms.map((term, i) => {
            const { field, op, value } = describeTerm(term);
            return (
              <span key={i} className="filter-chip">
                <b>{field}</b>
                <span className="op">{op}</span>
                <span>{value}</span>
                <button className="btn-icon" onClick={() => search.removeTerm(i)} aria-label={`Retirer le filtre ${field}`}>
                  <X />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
