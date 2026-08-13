import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useSessions, PAGE_SIZE } from "../../api/sessions";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { SortableTableHeader, type Column } from "../../components/SortableTableHeader";
import { Pagination } from "../../components/Pagination";

const COLUMNS: Column[] = [
  { key: "src_ip", label: "IP" },
  { key: "connect_time", label: "Début" },
  { key: "duration_ms", label: "Durée" },
  { key: "login_username", label: "Login" },
];

function formatDuration(ms: number | null): string {
  return ms ? `${Math.round(ms / 1000)}s` : "-";
}

interface ParamUpdate {
  ip?: string;
  sort: string;
  order: string;
  page?: string;
  session?: string;
}

export function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ip = searchParams.get("ip") ?? "";
  const sort = searchParams.get("sort") ?? "connect_time";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const [ipInput, setIpInput] = useState(ip);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setIpInput(ip);
  }, [ip]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { data, isPending, isError, refetch } = useSessions({ ip, sort, order, page });

  function updateParams(next: ParamUpdate) {
    const params = new URLSearchParams();
    if (next.ip) params.set("ip", next.ip);
    params.set("sort", next.sort);
    params.set("order", next.order);
    if (next.page) params.set("page", next.page);
    if (next.session) params.set("session", next.session);
    setSearchParams(params);
  }

  function handleFilterChange(value: string) {
    setIpInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ ip: value, sort, order });
    }, 300);
  }

  function handleSort(col: string) {
    const nextOrder = sort === col && order === "asc" ? "desc" : "asc";
    updateParams({ ip, sort: col, order: nextOrder });
  }

  function handleRowClick(id: string) {
    updateParams({ ip, sort, order, page: String(page), session: id });
  }

  if (isPending) return <SkeletonBlock rows={8} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <>
      <div className="topbar">
        <h1>Sessions</h1>
        <span className="result-count">
          {data.total} résultat{data.total > 1 ? "s" : ""}
        </span>
      </div>
      <div className="filter-bar">
        <Search />
        <input
          className="filter-input"
          placeholder="Filtrer par IP..."
          value={ipInput}
          onChange={(e) => handleFilterChange(e.target.value)}
        />
      </div>
      <table className="sessions-table">
        <thead>
          <tr>
            <SortableTableHeader columns={COLUMNS} sort={sort} order={order} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {data.items.length ? (
            data.items.map((s) => (
              <tr key={s.session_id} className="session-row" onClick={() => handleRowClick(s.session_id)}>
                <td className="mono">{s.src_ip}</td>
                <td className="mono">{s.connect_time}</td>
                <td>{formatDuration(s.duration_ms)}</td>
                <td>{s.login_username || "-"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4}>
                <EmptyState message="Aucune session" />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPrev={() => updateParams({ ip, sort, order, page: String(page - 1) })}
        onNext={() => updateParams({ ip, sort, order, page: String(page + 1) })}
      />
    </>
  );
}
