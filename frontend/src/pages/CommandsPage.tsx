import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useCommands, COMMANDS_PAGE_SIZE } from "../api/commands";
import { usePeriod, type Period } from "../theme/PeriodContext";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { formatTimestamp } from "../utils/formatDate";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7j" },
  { value: "30d", label: "30j" },
  { value: "all", label: "Tout" },
];

export function CommandsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const q = searchParams.get("q") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const [qInput, setQInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setQInput(q), [q]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { data, isPending, isError, refetch } = useCommands({ period, q, page });

  function updateParams(next: { q: string; page?: string }) {
    clearTimeout(debounceRef.current);
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    params.set("page", next.page ?? "1");
    setSearchParams(params);
  }

  function handleFilterChange(value: string) {
    setQInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value });
    }, 300);
  }

  function handlePeriodChange(value: Period) {
    setPeriod(value);
    updateParams({ q, page: "1" });
  }

  if (isPending) return <SkeletonBlock rows={8} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / COMMANDS_PAGE_SIZE));

  return (
    <>
      <div className="topbar">
        <h1>Commandes</h1>
        <div className="period-selector">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              className={`btn${period === p.value ? " active" : ""}`}
              onClick={() => handlePeriodChange(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-bar">
        <Search />
        <input
          className="filter-input"
          placeholder="Filtrer par commande..."
          value={qInput}
          onChange={(e) => handleFilterChange(e.target.value)}
        />
      </div>
      <table className="plain-table">
        <thead>
          <tr>
            <th>Commande</th>
            <th>Occurrences</th>
            <th>Dernière vue</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.items.length ? (
            data.items.map((c) => (
              <tr key={c.input_text}>
                <td className="mono">
                  <code>{c.input_text}</code>
                </td>
                <td>{c.n}</td>
                <td className="mono">{formatTimestamp(c.last_seen)}</td>
                <td>
                  <Link to={`/sessions?command=${encodeURIComponent(c.input_text)}`}>
                    Voir les sessions
                  </Link>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4}>
                <EmptyState message="Aucune donnée" />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPrev={() => updateParams({ q, page: String(page - 1) })}
        onNext={() => updateParams({ q, page: String(page + 1) })}
      />
    </>
  );
}
