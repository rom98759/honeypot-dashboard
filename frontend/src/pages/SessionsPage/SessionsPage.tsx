import { Link, useSearchParams } from "react-router-dom";
import { List } from "lucide-react";
import { useSessions, PAGE_SIZE } from "../../api/sessions";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { FilterChips, type FilterChip } from "../../components/FilterChips";
import { SortableTableHeader, type Column } from "../../components/SortableTableHeader";
import { Pagination } from "../../components/Pagination";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { PageHeader } from "../../components/PageHeader";
import { QueryBar } from "../../components/QueryBar";
import { useSearchFilter } from "../../theme/useSearchFilter";
import { filterErrorOf } from "../../api/client";
import { AcceptedLoginBadge } from "../../components/Badge";
import { formatTimestamp } from "../../utils/formatDate";
import { formatDuration, formatNumber } from "../../utils/format";
import { IpAddress } from "../../components/IpAddress";

const COLUMNS: Column[] = [
  { key: "src_ip", label: "IP" },
  { key: "connect_time", label: "Début" },
  { key: "duration_ms", label: "Durée" },
  { key: "login_username", label: "Login" },
];

interface ParamUpdate {
  filter?: string;
  command?: string;
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
  const search = useSearchFilter();
  const filter = search.filter;
  const command = searchParams.get("command") ?? "";
  const period = searchParams.get("period") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";
  const sort = searchParams.get("sort") ?? "connect_time";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const sessionId = searchParams.get("session");

  const { data, isPending, isError, error, refetch } = useSessions({
    filter,
    command,
    period,
    dateFrom,
    dateTo,
    sort,
    order,
    page,
  });

  const current = { filter, command, period, dateFrom, dateTo, sort, order, page: String(page) };
  const filterError = filterErrorOf(error);

  function updateParams(next: ParamUpdate) {
    const params = new URLSearchParams();
    if (next.filter) params.set("filter", next.filter);
    if (next.command) params.set("command", next.command);
    if (next.period) params.set("period", next.period);
    if (next.dateFrom) params.set("date_from", next.dateFrom);
    if (next.dateTo) params.set("date_to", next.dateTo);
    params.set("sort", next.sort);
    params.set("order", next.order);
    if (next.page) params.set("page", next.page);
    if (next.session) params.set("session", next.session);
    setSearchParams(params);
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

  function clearFilter(key: "command" | "period" | "dateRange") {
    if (key === "dateRange") {
      updateParams({ ...current, dateFrom: "", dateTo: "", page: undefined });
      return;
    }
    updateParams({ ...current, [key]: "", page: undefined });
  }

  if (isPending && !filterError) return <SkeletonBlock rows={8} />;
  if (isError && !filterError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const chips: FilterChip[] = [];
  if (command) chips.push({ label: `Commande exacte : ${command}`, onClear: () => clearFilter("command") });
  if (period) chips.push({ label: `Période : ${period}`, onClear: () => clearFilter("period") });
  if (dateFrom || dateTo) {
    chips.push({ label: `Plage : ${dateFrom} → ${dateTo}`, onClear: () => clearFilter("dateRange") });
  }

  return (
    <>
      <PageHeader
        title={
          <>
            <List />
            Sessions
          </>
        }
      >
        <span className="result-count">
          {formatNumber(total)} résultat{total > 1 ? "s" : ""}
        </span>
      </PageHeader>
      <div className="controls">
        <QueryBar search={search} serverError={filterError} />
      </div>
      <FilterChips chips={chips} />
      <section className="panel table-panel">
        <table className="sessions-table">
          <thead>
            <tr>
              <SortableTableHeader columns={COLUMNS} sort={sort} order={order} onSort={handleSort} />
              <th>Protocole</th>
              <th>Mot de passe</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.length ? (
              data.items.map((s) => (
                <tr key={s.session_id} className="session-row" onClick={() => handleRowClick(s.session_id)}>
                  <td className="mono">
                    <Link
                      to={`/ip/${encodeURIComponent(s.src_ip)}`}
                      className="ip-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IpAddress ip={s.src_ip} />
                    </Link>
                  </td>
                  <td className="mono cell-muted">{formatTimestamp(s.connect_time)}</td>
                  <td>{s.duration_ms ? formatDuration(s.duration_ms) : "-"}</td>
                  <td className="mono">{s.login_username || "-"}</td>
                  <td>{(s.protocol ?? "ssh").toUpperCase()}</td>
                  <td>
                    <span className="ip-cell">
                      <span className="mono">{s.login_password ?? "-"}</span>
                      {s.login_success ? <AcceptedLoginBadge /> : null}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>
                  <EmptyState message="Aucune session" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-footer">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => updateParams({ ...current, page: String(page - 1) })}
            onNext={() => updateParams({ ...current, page: String(page + 1) })}
          />
        </div>
      </section>
      {sessionId ? <SessionDetailPanel sessionId={sessionId} onClose={closePanel} /> : null}
    </>
  );
}
