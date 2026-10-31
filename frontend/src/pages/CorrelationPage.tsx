import { useSearchParams, Link } from "react-router-dom";
import { ExternalLink, Link2 } from "lucide-react";
import { useCorrelation } from "../api/correlation";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "../components/Badge";
import { SortableTableHeader, type Column } from "../components/SortableTableHeader";
import { PageHeader } from "../components/PageHeader";
import { formatNumber } from "../utils/format";
import type { CorrelationRow } from "../api/types";

const COLUMNS: Column[] = [
  { key: "ip", label: "IP" },
  { key: "honeypot_sessions", label: "Sessions honeypot" },
  { key: "fail2ban_banned", label: "Banni fail2ban" },
  { key: "real_ssh_attempts", label: "Tentatives port 50022" },
];

function comparableValue(v: string | number | boolean): string | number {
  return typeof v === "boolean" ? Number(v) : v;
}

function sortRows(rows: CorrelationRow[], sort: string, order: "asc" | "desc"): CorrelationRow[] {
  const key = sort as keyof CorrelationRow;
  const sorted = [...rows].sort((a, b) => {
    const av = comparableValue(a[key]);
    const bv = comparableValue(b[key]);
    if (av === bv) return 0;
    return av > bv ? 1 : -1;
  });
  return order === "desc" ? sorted.reverse() : sorted;
}

export function CorrelationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = searchParams.get("sort") ?? "honeypot_sessions";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";

  const { data, isPending, isError, refetch } = useCorrelation();

  if (isPending) return <SkeletonBlock rows={6} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const rows = sortRows(data, sort, order);

  function handleSort(col: string) {
    const nextOrder = sort === col && order === "asc" ? "desc" : "asc";
    setSearchParams({ sort: col, order: nextOrder });
  }

  return (
    <>
      <PageHeader
        title={
          <>
            <Link2 />
            Corrélation
          </>
        }
      >
        <span className="result-count">{formatNumber(rows.length)} IP</span>
      </PageHeader>
      <p className="page-description">
        Les IP vues par le honeypot, croisées avec les bans fail2ban et les tentatives sur le vrai sshd.
      </p>
      <section className="panel table-panel">
        <table className="correlation-table">
          <thead>
            <tr>
              <SortableTableHeader columns={COLUMNS} sort={sort} order={order} onSort={handleSort} />
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r.ip}>
                  <td className="mono">{r.ip}</td>
                  <td>
                    <b>{formatNumber(r.honeypot_sessions)}</b>
                  </td>
                  <td>
                    {r.fail2ban_banned ? (
                      <Badge label="Banni" tone="success" />
                    ) : (
                      <Badge label="Non banni" tone="neutral" />
                    )}
                  </td>
                  <td>
                    {r.real_ssh_attempts > 0 ? (
                      <Badge label={`${r.real_ssh_attempts} tentatives`} tone="warning" />
                    ) : (
                      <Badge label="Aucune" tone="neutral" />
                    )}
                  </td>
                  <td className="cell-actions">
                    <Link className="btn-icon" to={`/ip/${encodeURIComponent(r.ip)}`} title="Voir le détail">
                      <ExternalLink />
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  <EmptyState message="Aucune donnée" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
