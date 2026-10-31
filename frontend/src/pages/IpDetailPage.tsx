import { useParams, useSearchParams } from "react-router-dom";
import { useIpSummary, useIpFail2ban, useIpSshdAuth, useBanIp, useUnbanIp, IP_PAGE_SIZE } from "../api/ip";
import { useSessions, PAGE_SIZE } from "../api/sessions";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/Badge";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { SortableTableHeader, type Column } from "../components/SortableTableHeader";
import { Pagination } from "../components/Pagination";
import { SessionDetailPanel } from "./SessionsPage/SessionDetailPanel";
import { formatTimestamp } from "../utils/formatDate";
import { countryLabel, flagEmoji, formatDuration, formatNumber } from "../utils/format";

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

const SCORE_COLORS = { danger: "var(--danger)", warning: "var(--warning)", success: "var(--success)" };

function abuseipdbTone(score: number): "danger" | "warning" | "success" {
  if (score >= 75) return "danger";
  if (score >= 25) return "warning";
  return "success";
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
  const location = [data.city, data.country].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title={
          <>
            <span className="flag" aria-hidden="true">
              {flagEmoji(data.country_code)}
            </span>
            <span className="mono">{ip}</span>
          </>
        }
      >
        <div className="header-actions">
          {data.currently_banned ? (
            <Badge label="Banni" tone="success" />
          ) : (
            <Badge label="Non banni" tone="neutral" />
          )}
          {data.currently_banned ? (
            <button className="btn" disabled={unbanMutation.isPending} onClick={() => unbanMutation.mutate()}>
              Débannir
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={banMutation.isPending}
              onClick={() => banMutation.mutate()}
            >
              Bannir
            </button>
          )}
        </div>
      </PageHeader>
      {banActionError ? (
        <ErrorState
          message="Échec de l'action, réessaie."
          onRetry={() => (data.currently_banned ? unbanMutation.reset() : banMutation.reset())}
        />
      ) : null}

      <div className="metrics-bar">
        <MetricCard label="Sessions" value={formatNumber(data.total_sessions)} />
        <MetricCard label="Commandes" value={formatNumber(data.total_commands)} />
        <MetricCard label="Première vue" value={data.first_seen ? formatTimestamp(data.first_seen) : "-"} small />
        <MetricCard label="Dernière vue" value={data.last_seen ? formatTimestamp(data.last_seen) : "-"} small />
      </div>

      <div className={data.abuseipdb_configured ? "panel-row" : undefined}>
        <section className="panel">
          <h2>Enrichissement</h2>
          {data.enrichment_status === "pending" ? (
            <SkeletonBlock rows={3} />
          ) : (
            <dl className="kv">
              <dt>Localisation</dt>
              <dd>
                {location ? (
                  <span className="ip-cell">
                    <span className="flag" title={countryLabel(data.country_code, data.country)}>
                      {flagEmoji(data.country_code)}
                    </span>
                    <span>{location}</span>
                  </span>
                ) : (
                  "Non géolocalisé"
                )}
              </dd>
              <dt>ASN</dt>
              <dd>{data.asn ? `AS${data.asn} · ${data.asn_org ?? ""}` : "Non résolu"}</dd>
              <dt>Reverse DNS</dt>
              <dd className="mono">{data.reverse_dns ?? "Aucun"}</dd>
            </dl>
          )}
        </section>
        {data.abuseipdb_configured ? (
          <section className="panel">
            <h2>Réputation</h2>
            {data.enrichment_status === "pending" ? (
              <SkeletonBlock rows={3} />
            ) : data.abuseipdb_score !== null ? (
              <>
                <div className="score">
                  <b>{data.abuseipdb_score}</b>
                  <span>/ 100 sur AbuseIPDB</span>
                </div>
                <div className="score-bar">
                  <i
                    style={{
                      width: `${data.abuseipdb_score}%`,
                      background: SCORE_COLORS[abuseipdbTone(data.abuseipdb_score)],
                    }}
                  />
                </div>
                <div className="reputation-row">
                  <Badge label={`Score ${data.abuseipdb_score}/100`} tone={abuseipdbTone(data.abuseipdb_score)} />
                  <span className="cell-muted">
                    {data.abuseipdb_total_reports} signalement(s)
                    {data.abuseipdb_last_reported_at
                      ? ` — dernier le ${formatTimestamp(data.abuseipdb_last_reported_at)}`
                      : ""}
                  </span>
                </div>
              </>
            ) : (
              <EmptyState message="Aucune donnée AbuseIPDB" />
            )}
          </section>
        ) : null}
      </div>

      <section className="panel table-panel">
        <div className="panel-title">
          <h2>Sessions honeypot</h2>
        </div>
        {sessions.isPending ? (
          <SkeletonBlock rows={4} />
        ) : sessions.isError ? (
          <ErrorState message="Erreur de chargement, réessaie." onRetry={() => sessions.refetch()} />
        ) : (
          <>
            <table className="sessions-table">
              <thead>
                <tr>
                  <SortableTableHeader columns={SESSION_COLUMNS} sort={sort} order={order} onSort={handleSort} />
                  <th>Protocole</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.items.length ? (
                  sessions.data.items.map((s) => (
                    <tr key={s.session_id} className="session-row" onClick={() => handleRowClick(s.session_id)}>
                      <td className="mono cell-muted">{formatTimestamp(s.connect_time)}</td>
                      <td>{s.duration_ms ? formatDuration(s.duration_ms) : "-"}</td>
                      <td className="mono">{s.login_username || "-"}</td>
                      <td>{(s.protocol ?? "ssh").toUpperCase()}</td>
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
            <div className="table-footer">
              <Pagination
                page={page}
                totalPages={Math.max(1, Math.ceil(sessions.data.total / PAGE_SIZE))}
                onPrev={() => updateParams({ page: String(page - 1) })}
                onNext={() => updateParams({ page: String(page + 1) })}
              />
            </div>
          </>
        )}
      </section>

      <div className="panel-row">
        <section className="panel table-panel">
          <div className="panel-title">
            <h2>Historique fail2ban</h2>
          </div>
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
                          <Badge
                            label={FAIL2BAN_ACTION_LABELS[e.action] ?? e.action}
                            tone={e.action === "Unban" ? "success" : "danger"}
                          />
                        </td>
                        <td>{e.jail}</td>
                        <td className="mono cell-muted">{formatTimestamp(e.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState message="Aucun événement fail2ban" />
              )}
              <div className="table-footer">
                <Pagination
                  page={f2bPage}
                  totalPages={Math.max(1, Math.ceil(fail2ban.data.total / IP_PAGE_SIZE))}
                  onPrev={() => updateParams({ f2b_page: String(f2bPage - 1) })}
                  onNext={() => updateParams({ f2b_page: String(f2bPage + 1) })}
                />
              </div>
            </>
          )}
        </section>

        <section className="panel table-panel">
          <div className="panel-title">
            <h2>Tentatives sshd réelles</h2>
          </div>
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
                          <Badge
                            label={SSHD_RESULT_LABELS[e.result] ?? e.result}
                            tone={e.result === "accepted" ? "danger" : "warning"}
                          />
                        </td>
                        <td className="mono cell-muted">{formatTimestamp(e.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState message="Aucune tentative sshd réelle" />
              )}
              <div className="table-footer">
                <Pagination
                  page={sshdPage}
                  totalPages={Math.max(1, Math.ceil(sshdAuth.data.total / IP_PAGE_SIZE))}
                  onPrev={() => updateParams({ sshd_page: String(sshdPage - 1) })}
                  onNext={() => updateParams({ sshd_page: String(sshdPage + 1) })}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {sessionId ? <SessionDetailPanel sessionId={sessionId} onClose={closePanel} /> : null}
    </>
  );
}
