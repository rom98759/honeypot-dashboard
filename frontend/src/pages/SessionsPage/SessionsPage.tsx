import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useSessions, PAGE_SIZE } from "../../api/sessions";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { FilterChips, type FilterChip } from "../../components/FilterChips";
import { SortableTableHeader, type Column } from "../../components/SortableTableHeader";
import { Pagination } from "../../components/Pagination";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { formatTimestamp } from "../../utils/formatDate";

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
  command?: string;
  protocol?: string;
  country?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: string;
  order: string;
  page?: string;
  session?: string;
}

export function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ip = searchParams.get("ip") ?? "";
  const command = searchParams.get("command") ?? "";
  const protocol = searchParams.get("protocol") ?? "";
  const country = searchParams.get("country") ?? "";
  const period = searchParams.get("period") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";
  const sort = searchParams.get("sort") ?? "connect_time";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const sessionId = searchParams.get("session");

  const [ipInput, setIpInput] = useState(ip);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setIpInput(ip);
  }, [ip]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { data, isPending, isError, refetch } = useSessions({
    ip,
    command,
    protocol,
    country,
    period,
    dateFrom,
    dateTo,
    sort,
    order,
    page,
  });

  const current = { ip, command, protocol, country, period, dateFrom, dateTo, sort, order, page: String(page) };

  function updateParams(next: ParamUpdate) {
    clearTimeout(debounceRef.current);
    const params = new URLSearchParams();
    if (next.ip) params.set("ip", next.ip);
    if (next.command) params.set("command", next.command);
    if (next.protocol) params.set("protocol", next.protocol);
    if (next.country) params.set("country", next.country);
    if (next.period) params.set("period", next.period);
    if (next.dateFrom) params.set("date_from", next.dateFrom);
    if (next.dateTo) params.set("date_to", next.dateTo);
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
      updateParams({ ...current, ip: value });
    }, 300);
  }

  function handleSort(col: string) {
    const nextOrder = sort === col && order === "asc" ? "desc" : "asc";
    updateParams({ ...current, sort: col, order: nextOrder });
  }

  function handleRowClick(id: string) {
    updateParams({ ...current, session: id });
  }

  function closePanel() {
    updateParams(current);
  }

  function clearFilter(key: "command" | "protocol" | "country" | "period" | "dateRange") {
    if (key === "dateRange") {
      updateParams({ ...current, dateFrom: "", dateTo: "", page: undefined });
      return;
    }
    updateParams({ ...current, [key]: "", page: undefined });
  }

  if (isPending) return <SkeletonBlock rows={8} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const chips: FilterChip[] = [];
  if (command) chips.push({ label: `Commande : ${command}`, onClear: () => clearFilter("command") });
  if (protocol) chips.push({ label: `Protocole : ${protocol}`, onClear: () => clearFilter("protocol") });
  if (country) chips.push({ label: `Pays : ${country}`, onClear: () => clearFilter("country") });
  if (period) chips.push({ label: `Période : ${period}`, onClear: () => clearFilter("period") });
  if (dateFrom || dateTo) {
    chips.push({ label: `Plage : ${dateFrom} → ${dateTo}`, onClear: () => clearFilter("dateRange") });
  }

  return (
    <>
      <div className="topbar">
        <h1>Sessions</h1>
        <span className="result-count">
          {data.total} résultat{data.total > 1 ? "s" : ""}
        </span>
      </div>
      <FilterChips chips={chips} />
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
                <td className="mono">
                  <Link
                    to={`/ip/${encodeURIComponent(s.src_ip)}`}
                    className="ip-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.src_ip}
                  </Link>
                </td>
                <td className="mono">{formatTimestamp(s.connect_time)}</td>
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
        onPrev={() => updateParams({ ...current, page: String(page - 1) })}
        onNext={() => updateParams({ ...current, page: String(page + 1) })}
      />
      {sessionId ? <SessionDetailPanel sessionId={sessionId} onClose={closePanel} /> : null}
    </>
  );
}
