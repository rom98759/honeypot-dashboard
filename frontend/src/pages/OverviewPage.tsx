import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useOverview } from "../api/overview";
import { StatCard } from "../components/StatCard";
import { ProportionList } from "../components/ProportionList";
import { TimelineChart } from "../components/TimelineChart";
import { ProtocolDonut } from "../components/ProtocolDonut";
import { BansBarChart } from "../components/BansBarChart";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import type { OverviewPeriod } from "../api/types";

const PERIODS: { value: OverviewPeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7j" },
  { value: "30d", label: "30j" },
  { value: "all", label: "Tout" },
];

export function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPeriod = searchParams.get("period");
  const period = PERIODS.some((p) => p.value === requestedPeriod)
    ? (requestedPeriod as OverviewPeriod)
    : "24h";

  const { data, isPending, isError, refetch } = useOverview(period);

  function handlePeriodChange(value: OverviewPeriod) {
    setSearchParams({ period: value });
  }

  if (isPending) return <SkeletonBlock rows={6} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  return (
    <>
      <div className="topbar">
        <h1>Overview</h1>
        <div className="map-controls">
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
          <button className="btn" onClick={() => refetch()}>
            <RefreshCw />
            Actualiser
          </button>
        </div>
      </div>
      <div className="cards">
        <StatCard label="Connexions" value={data.total_connections} />
        <StatCard label="IP uniques" value={data.unique_ips} />
        <StatCard label="Logins tentés" value={data.login_attempts} />
        <StatCard label="Actuellement banni" value={data.currently_banned} danger />
      </div>
      <div className="panel timeline-panel">
        <h3>Timeline</h3>
        <div className="chart-container">
          {data.timeline.length ? <TimelineChart timeline={data.timeline} /> : null}
        </div>
      </div>
      <div className="panels">
        <div className="panel">
          <h3>Protocole</h3>
          {data.protocol_split.length ? (
            <div className="chart-container">
              <ProtocolDonut protocolSplit={data.protocol_split} />
            </div>
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
        <div className="panel">
          <h3>Bans dans le temps</h3>
          {data.bans_timeline.length ? (
            <div className="chart-container">
              <BansBarChart bansTimeline={data.bans_timeline} />
            </div>
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
      </div>
      <div className="panels">
        <div className="panel">
          <h3>Top pays</h3>
          {data.top_countries.length ? (
            <ProportionList items={data.top_countries.map((c) => ({ label: c.country, n: c.n }))} />
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
        <div className="panel">
          <h3>Top IP</h3>
          {data.top_ips.length ? (
            <ProportionList
              items={data.top_ips.map((i) => ({ label: i.src_ip, n: i.n }))}
              linkPrefix="/ip/"
            />
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
      </div>
      <div className="panel">
        <h3>Top identifiants tentés</h3>
        {data.top_credentials.length ? (
          <table className="plain-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Password</th>
                <th>Tentatives</th>
              </tr>
            </thead>
            <tbody>
              {data.top_credentials.map((c, i) => (
                <tr key={`${c.login_username}:${c.login_password ?? ""}:${i}`}>
                  <td className="mono">{c.login_username}</td>
                  <td className="mono">{c.login_password ?? "(vide)"}</td>
                  <td>{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message="Aucune donnée" />
        )}
      </div>
    </>
  );
}
