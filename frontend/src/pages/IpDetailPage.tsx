import { useParams, useSearchParams } from "react-router-dom";
import { useIpSummary, useIpFail2ban, useIpSshdAuth, useBanIp, useUnbanIp, IP_PAGE_SIZE } from "../api/ip";
import { useSessions, PAGE_SIZE } from "../api/sessions";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/Badge";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { SortableTableHeader, type Column } from "../components/SortableTableHeader";
import { Pagination } from "../components/Pagination";
import { SessionDetailPanel } from "./SessionsPage/SessionDetailPanel";
import { formatTimestamp } from "../utils/formatDate";

const SESSION_COLUMNS: Column[] = [
  { key: "connect_time", label: "Début" },
  { key: "duration_ms", label: "Durée" },
  { key: "login_username", label: "Login" },
];

const FAIL2BAN_ACTION_LABELS: Record<string, string> = {
  Ban: "Ban",
  "Restore Ban": "Ban restauré",
  Unban: "Unban",
};

const SSHD_RESULT_LABELS: Record<string, string> = {
  accepted: "Accepté",
  failed_password: "Mot de passe échoué",
  invalid_user: "Utilisateur invalide",
  other: "Autre",
};

function formatDuration(ms: number | null): string {
  return ms ? `${Math.round(ms / 1000)}s` : "-";
}

export function IpDetailPage() {
  const { ip = "" } = useParams<{ ip: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = searchParams.get("sort") ?? "connect_time";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const sessionId = searchParams.get("session");
  const f2bPage = Math.max(1, parseInt(searchParams.get("f2b_page") ?? "1", 10) || 1);
  const sshdPage = Math.max(1, parseInt(searchParams.get("sshd_page") ?? "1", 10) || 1);

  const summary = useIpSummary(ip);
  const sessions = useSessions({ ip, sort, order, page });
  const fail2ban = useIpFail2ban(ip, f2bPage);
  const sshdAuth = useIpSshdAuth(ip, sshdPage);
  const banMutation = useBanIp(ip);
  const unbanMutation = useUnbanIp(ip);
  const banActionError = banMutation.isError || unbanMutation.isError;

  function updateParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params);
  }

  function handleSort(col: string) {
    const nextOrder = sort === col && order === "asc" ? "desc" : "asc";
    updateParams({ sort: col, order: nextOrder, page: "" });
  }

  function handleRowClick(id: string) {
    updateParams({ session: id, page: String(page) });
  }

  function closePanel() {
    updateParams({ session: "" });
  }

  if (summary.isPending) return <SkeletonBlock rows={8} />;
  if (summary.isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => summary.refetch()} />;
  }

  const data = summary.data;

  return (
    <>
      <div className="topbar">
        <h1 className="mono">{ip}</h1>
        {data.currently_banned ? (
          <Badge label="Banni" tone="success" />
        ) : (
          <Badge label="Non banni" tone="neutral" />
        )}
        {data.currently_banned ? (
          <button
            className="btn"
            disabled={unbanMutation.isPending}
            onClick={() => unbanMutation.mutate()}
          >
            Débannir
          </button>
        ) : (
          <button className="btn" disabled={banMutation.isPending} onClick={() => banMutation.mutate()}>
            Bannir
          </button>
        )}
      </div>
      {banActionError ? (
        <ErrorState
          message="Échec de l'action, réessaie."
          onRetry={() => (data.currently_banned ? unbanMutation.reset() : banMutation.reset())}
        />
      ) : null}
      <div className="cards">
        <StatCard
          label="Localisation"
          value={data.city && data.country ? `${data.city}, ${data.country}` : "Non géolocalisé"}
          small
        />
        <StatCard label="Sessions" value={data.total_sessions} />
        <StatCard label="Commandes" value={data.total_commands} />
        <StatCard label="Première vue" value={data.first_seen ? formatTimestamp(data.first_seen) : "-"} small />
        <StatCard label="Dernière vue" value={data.last_seen ? formatTimestamp(data.last_seen) : "-"} small />
      </div>

      <div className="panel">
        <h3>Sessions honeypot</h3>
        {sessions.isPending ? (
          <SkeletonBlock rows={4} />
        ) : sessions.isError ? (
          <ErrorState message="Erreur de chargement, réessaie." onRetry={() => sessions.refetch()} />
        ) : (
          <>
            <table className="sessions-table">
              <thead>
                <tr>
                  <SortableTableHeader
                    columns={SESSION_COLUMNS}
                    sort={sort}
                    order={order}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sessions.data.items.length ? (
                  sessions.data.items.map((s) => (
                    <tr key={s.session_id} className="session-row" onClick={() => handleRowClick(s.session_id)}>
                      <td className="mono">{formatTimestamp(s.connect_time)}</td>
                      <td>{formatDuration(s.duration_ms)}</td>
                      <td>{s.login_username || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState message="Aucune session" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(sessions.data.total / PAGE_SIZE))}
              onPrev={() => updateParams({ page: String(page - 1) })}
              onNext={() => updateParams({ page: String(page + 1) })}
            />
          </>
        )}
      </div>

      <div className="panel">
        <h3>Historique fail2ban</h3>
        {fail2ban.isPending ? (
          <SkeletonBlock rows={4} />
        ) : fail2ban.isError ? (
          <ErrorState message="Erreur de chargement, réessaie." onRetry={() => fail2ban.refetch()} />
        ) : (
          <>
            {fail2ban.data.items.length ? (
              <table className="plain-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Jail</th>
                    <th>Horodatage</th>
                  </tr>
                </thead>
                <tbody>
                  {fail2ban.data.items.map((e, i) => (
                    <tr key={i}>
                      <td>
                        {e.action === "Unban" ? (
                          <Badge label={FAIL2BAN_ACTION_LABELS[e.action] ?? e.action} tone="success" />
                        ) : (
                          <Badge label={FAIL2BAN_ACTION_LABELS[e.action] ?? e.action} tone="danger" />
                        )}
                      </td>
                      <td>{e.jail}</td>
                      <td className="mono">{formatTimestamp(e.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState message="Aucun événement fail2ban" />
            )}
            <Pagination
              page={f2bPage}
              totalPages={Math.max(1, Math.ceil(fail2ban.data.total / IP_PAGE_SIZE))}
              onPrev={() => updateParams({ f2b_page: String(f2bPage - 1) })}
              onNext={() => updateParams({ f2b_page: String(f2bPage + 1) })}
            />
          </>
        )}
      </div>

      <div className="panel">
        <h3>Historique tentatives sshd</h3>
        {sshdAuth.isPending ? (
          <SkeletonBlock rows={4} />
        ) : sshdAuth.isError ? (
          <ErrorState message="Erreur de chargement, réessaie." onRetry={() => sshdAuth.refetch()} />
        ) : (
          <>
            {sshdAuth.data.items.length ? (
              <table className="plain-table">
                <thead>
                  <tr>
                    <th>Résultat</th>
                    <th>Horodatage</th>
                  </tr>
                </thead>
                <tbody>
                  {sshdAuth.data.items.map((e, i) => (
                    <tr key={i}>
                      <td>
                        {e.result === "accepted" ? (
                          <Badge label={SSHD_RESULT_LABELS[e.result] ?? e.result} tone="danger" />
                        ) : (
                          <Badge label={SSHD_RESULT_LABELS[e.result] ?? e.result} tone="warning" />
                        )}
                      </td>
                      <td className="mono">{formatTimestamp(e.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState message="Aucune tentative sshd réelle" />
            )}
            <Pagination
              page={sshdPage}
              totalPages={Math.max(1, Math.ceil(sshdAuth.data.total / IP_PAGE_SIZE))}
              onPrev={() => updateParams({ sshd_page: String(sshdPage - 1) })}
              onNext={() => updateParams({ sshd_page: String(sshdPage + 1) })}
            />
          </>
        )}
      </div>

      {sessionId ? <SessionDetailPanel sessionId={sessionId} onClose={closePanel} /> : null}
    </>
  );
}
