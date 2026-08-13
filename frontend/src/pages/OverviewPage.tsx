import { RefreshCw } from "lucide-react";
import { useOverview } from "../api/overview";
import { StatCard } from "../components/StatCard";
import { ProportionList } from "../components/ProportionList";
import { TimelineChart } from "../components/TimelineChart";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";

export function OverviewPage() {
  const { data, isPending, isError, refetch } = useOverview();

  if (isPending) return <SkeletonBlock rows={6} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  return (
    <>
      <div className="topbar">
        <h1>Overview</h1>
        <button className="btn" onClick={() => refetch()}>
          <RefreshCw />
          Actualiser
        </button>
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
            <ProportionList items={data.top_ips.map((i) => ({ label: i.src_ip, n: i.n }))} />
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
      </div>
    </>
  );
}
