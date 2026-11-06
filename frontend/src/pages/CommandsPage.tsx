import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { List as ListIcon, Terminal } from "lucide-react";
import { useCommands, COMMANDS_PAGE_SIZE } from "../api/commands";
import { usePeriod, type Period } from "../theme/PeriodContext";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { PageHeader } from "../components/PageHeader";
import { PeriodSelect } from "../components/PeriodSelect";
import { SearchField } from "../components/SearchField";
import { QueryBar } from "../components/QueryBar";
import { useSearchFilter } from "../theme/useSearchFilter";
import { filterErrorOf } from "../api/client";
import { formatNumber } from "../utils/format";
import { formatTimestamp } from "../utils/formatDate";

export function CommandsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const q = searchParams.get("q") ?? "";
  const search = useSearchFilter();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const [qInput, setQInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setQInput(q), [q]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { data, isPending, isError, error, refetch } = useCommands({ period, q, filter: search.filter, page });
  const filterError = filterErrorOf(error);

  function updateParams(next: { q: string; page?: string; period: Period }) {
    clearTimeout(debounceRef.current);
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    if (search.filter) params.set("filter", search.filter);
    params.set("page", next.page ?? "1");
    params.set("period", next.period);
    setSearchParams(params);
  }

  function handleFilterChange(value: string) {
    setQInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value, period });
    }, 300);
  }

  function handlePeriodChange(value: Period) {
    setPeriod(value);
    updateParams({ q, page: "1", period: value });
  }

  if (isPending && !filterError) return <SkeletonBlock rows={8} />;
  if (isError && !filterError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / COMMANDS_PAGE_SIZE));
  const sessionsFilter = search.filter ? `&filter=${encodeURIComponent(search.filter)}` : "";

  return (
    <>
      <PageHeader
        title={
          <>
            <Terminal />
            Commandes
          </>
        }
      >
        <PeriodSelect value={period} onChange={handlePeriodChange} />
      </PageHeader>
      <div className="controls">
        <QueryBar search={search} serverError={filterError} />
      </div>
      <div className="controls">
        <SearchField value={qInput} placeholder="Filtrer par commande..." onChange={handleFilterChange} />
      </div>
      <section className="panel table-panel">
        <table className="plain-table">
          <thead>
            <tr>
              <th>Commande</th>
              <th className="cell-num">Occurrences</th>
              <th>Dernière vue</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.length ? (
              data.items.map((c) => (
                <tr key={c.input_text}>
                  <td className="mono command-cell">
                    <code title={c.input_text}>{c.input_text}</code>
                  </td>
                  <td className="cell-num">{formatNumber(c.n)}</td>
                  <td className="mono cell-muted">{formatTimestamp(c.last_seen)}</td>
                  <td className="cell-actions">
                    <Link
                      className="btn btn-sm"
                      to={`/sessions?command=${encodeURIComponent(c.input_text)}&period=${period}${sessionsFilter}`}
                    >
                      <ListIcon />
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
        <div className="table-footer">
          <span className="result-count">{formatNumber(data?.total ?? 0)} commandes distinctes</span>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => updateParams({ q, page: String(page - 1), period })}
            onNext={() => updateParams({ q, page: String(page + 1), period })}
          />
        </div>
      </section>
    </>
  );
}
