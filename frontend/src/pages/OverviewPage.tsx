import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import type { Chart as ChartJS } from "chart.js";
import { usePeriod } from "../theme/PeriodContext";
import { useOverview, useOverviewHeatmap } from "../api/overview";
import { StatCard } from "../components/StatCard";
import { ProportionList } from "../components/ProportionList";
import { TimelineChart } from "../components/TimelineChart";
import { ProtocolDonut } from "../components/ProtocolDonut";
import { BansBarChart } from "../components/BansBarChart";
import { OffendersLeaderboard } from "../components/OffendersLeaderboard";
import { AttackHeatmap } from "../components/AttackHeatmap";
import { DurationDistributionChart } from "../components/DurationDistributionChart";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { bucketRangeToDates } from "../utils/bucket";
import type { OverviewPeriod } from "../api/types";

const PERIODS: { value: OverviewPeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7j" },
  { value: "30d", label: "30j" },
  { value: "all", label: "Tout" },
];

export function OverviewPage() {
  const [, setSearchParams] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const navigate = useNavigate();
  const chartRef = useRef<ChartJS<"line"> | undefined>(undefined);
  const [zoomRange, setZoomRange] = useState<{ start: string; end: string } | null>(null);

  const { data, isPending, isError, refetch } = useOverview(period);
  const heatmap = useOverviewHeatmap();

  function handlePeriodChange(value: OverviewPeriod) {
    setPeriod(value);
    setSearchParams({ period: value });
  }

  function goToSessions(params: Record<string, string>) {
    navigate(`/sessions?${new URLSearchParams(params).toString()}`);
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
          {data.timeline.length ? (
            <TimelineChart timeline={data.timeline} ref={chartRef} onRangeChange={setZoomRange} />
          ) : null}
        </div>
        {zoomRange ? (
          <div className="chart-actions">
            <button
              className="btn"
              onClick={() => goToSessions(bucketRangeToDates(zoomRange.start, zoomRange.end))}
            >
              Voir les sessions de cette période
            </button>
            <button
              className="btn"
              onClick={() => {
                chartRef.current?.resetZoom();
                setZoomRange(null);
              }}
            >
              Réinitialiser le zoom
            </button>
          </div>
        ) : null}
      </div>
      <div className="panels">
        <div className="panel">
          <h3>Protocole</h3>
          {data.protocol_split.length ? (
            <div className="chart-container">
              <ProtocolDonut
                protocolSplit={data.protocol_split}
                onSliceClick={(p) => goToSessions({ protocol: p, period })}
              />
            </div>
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
        <div className="panel">
          <h3>Bans dans le temps</h3>
          {data.bans_timeline.length ? (
            <div className="chart-container">
              <BansBarChart
                bansTimeline={data.bans_timeline}
                onBarClick={(bucket) => goToSessions(bucketRangeToDates(bucket, bucket))}
              />
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
            <ProportionList
              items={data.top_countries.map((c) => ({ label: c.country, n: c.n }))}
              linkTo={(item) => `/sessions?country=${encodeURIComponent(item.label)}&period=${period}`}
            />
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </div>
        <div className="panel">
          <h3>Top offenders</h3>
          {data.top_offenders.length ? (
            <OffendersLeaderboard offenders={data.top_offenders} />
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
      <div className="panel">
        <h3>Durée des sessions</h3>
        {data.duration_distribution.some((d) => d.n > 0) ? (
          <div className="chart-container">
            <DurationDistributionChart distribution={data.duration_distribution} />
          </div>
        ) : (
          <EmptyState message="Aucune donnée" />
        )}
      </div>
      <div className="panel">
        <h3>Répartition horaire des attaques (tout l'historique)</h3>
        {heatmap.isPending ? (
          <SkeletonBlock rows={4} />
        ) : heatmap.isError ? (
          <ErrorState message="Erreur de chargement, réessaie." onRetry={() => heatmap.refetch()} />
        ) : heatmap.data.cells.length ? (
          <AttackHeatmap cells={heatmap.data.cells} />
        ) : (
          <EmptyState message="Aucune donnée" />
        )}
      </div>
    </>
  );
}
