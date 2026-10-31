import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, List as ListIcon, Shield } from "lucide-react";
import { usePeriod } from "../theme/PeriodContext";
import { useFilters } from "../theme/useFilters";
import { useOverview, useOverviewHeatmap } from "../api/overview";
import { ActivityChart } from "../components/ActivityChart";
import { ListTable, type ListRow } from "../components/ListTable";
import { TabsPanel } from "../components/TabsPanel";
import { MetricCard } from "../components/MetricCard";
import { PeriodSelect } from "../components/PeriodSelect";
import { FilterButton, ActiveFilters } from "../components/FilterBar";
import { LiveIndicator, PageHeader } from "../components/PageHeader";
import { WorldMap } from "../components/WorldMap";
import { WeeklyTraffic } from "../components/WeeklyTraffic";
import { BansBarChart } from "../components/BansBarChart";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { buildSeries } from "../utils/timeSeries";
import { bucketRangeToDates } from "../utils/bucket";
import { countryLabel, flagEmoji, formatDuration, formatNumber, percentChange } from "../utils/format";
import type { Filters, OverviewData } from "../api/types";

function sessionsUrl(params: Record<string, string | undefined>): string {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>;
  return `/sessions?${new URLSearchParams(clean).toString()}`;
}

export function OverviewPage() {
  const [period] = usePeriod();
  const { filters, setFilter, removeFilter, changePeriod } = useFilters();
  const navigate = useNavigate();

  const { data, isPending, isError, refetch } = useOverview(period, filters);
  const heatmap = useOverviewHeatmap();

  if (isPending) return <SkeletonBlock rows={6} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const prev = data.previous;
  const sessionFilters = { period, ip: filters.ip, protocol: filters.protocol, country: filters.country };

  return (
    <>
      <PageHeader
        title={
          <>
            <Shield />
            Honeypot
          </>
        }
      >
        <LiveIndicator count={data.active_sessions} />
      </PageHeader>

      <div className="controls">
        <div className="controls-group">
          <FilterButton suggestions={suggestionsFrom(data)} onAdd={setFilter} />
          <ActiveFilters filters={filters} onRemove={removeFilter} />
        </div>
        <div className="controls-group">
          <Link className="btn" to={sessionsUrl(sessionFilters)}>
            <ListIcon />
            Voir les sessions
          </Link>
          <PeriodSelect value={period} onChange={changePeriod} />
        </div>
      </div>

      <div className="metrics-bar">
        <MetricCard
          label="Connexions"
          value={formatNumber(data.total_connections)}
          change={percentChange(data.total_connections, prev?.total_connections)}
          reverseColors
        />
        <MetricCard
          label="IP uniques"
          value={formatNumber(data.unique_ips)}
          change={percentChange(data.unique_ips, prev?.unique_ips)}
          reverseColors
        />
        <MetricCard
          label="Logins tentés"
          value={formatNumber(data.login_attempts)}
          change={percentChange(data.login_attempts, prev?.login_attempts)}
          reverseColors
        />
        <MetricCard
          label="Durée moyenne"
          value={formatDuration(data.avg_duration_ms)}
          change={
            data.avg_duration_ms != null && prev?.avg_duration_ms != null
              ? percentChange(data.avg_duration_ms, prev.avg_duration_ms)
              : null
          }
          reverseColors
        />
        <MetricCard label="IP bannies" value={formatNumber(data.currently_banned)} />
      </div>

      <section className="panel">
        {data.timeline.length || period !== "all" ? (
          <ActivityChart
            series={buildSeries(data.timeline, period)}
            onBucketClick={(p) => navigate(sessionsUrl({ ...sessionFilters, period: undefined, date_from: p.from, date_to: p.to }))}
          />
        ) : (
          <EmptyState message="Aucune session sur la période" />
        )}
      </section>

      <div className="panel-row">
        <TabsPanel
          title="Identifiants"
          tabs={[
            {
              id: "combo",
              label: "Combinaisons",
              content: (
                <ListTable
                  title="Utilisateur / mot de passe"
                  metric="Tentatives"
                  rows={data.top_credentials.map((c) => ({
                    key: `${c.login_username}\u0000${c.login_password ?? ""}`,
                    label: (
                      <span className="mono">
                        {c.login_username} / {c.login_password ?? "(vide)"}
                      </span>
                    ),
                    value: c.n,
                    onClick: () => setFilter("username", c.login_username),
                  }))}
                />
              ),
            },
            {
              id: "user",
              label: "Utilisateurs",
              content: (
                <ListTable
                  title="Utilisateur"
                  metric="Tentatives"
                  rows={data.top_usernames.map((u) => ({
                    key: u.value,
                    label: <span className="mono">{u.value}</span>,
                    value: u.n,
                    onClick: () => setFilter("username", u.value),
                  }))}
                />
              ),
            },
            {
              id: "password",
              label: "Mots de passe",
              content: (
                <ListTable
                  title="Mot de passe"
                  metric="Tentatives"
                  rows={data.top_passwords.map((p) => ({
                    key: p.value,
                    label: <span className="mono">{p.value || "(vide)"}</span>,
                    value: p.n,
                  }))}
                />
              ),
            },
          ]}
        />
        <TabsPanel
          title="Sources"
          tabs={[
            {
              id: "ip",
              label: "IP",
              content: (
                <ListTable
                  title="IP"
                  metric="Sessions"
                  rows={data.top_offenders.map((o) => ({
                    key: o.src_ip,
                    label: (
                      <>
                        <span className="flag" title={countryLabel(o.country_code, o.country)}>
                          {flagEmoji(o.country_code)}
                        </span>
                        <span className="mono">{o.src_ip}</span>
                        <Link
                          to={`/ip/${encodeURIComponent(o.src_ip)}`}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Détail de ${o.src_ip}`}
                        >
                          <ExternalLink />
                        </Link>
                      </>
                    ),
                    value: o.n,
                    onClick: () => setFilter("ip", o.src_ip),
                  }))}
                />
              ),
            },
            {
              id: "country",
              label: "Pays",
              content: (
                <ListTable title="Pays" metric="Sessions" rows={countryRows(data, setFilter)} />
              ),
            },
            {
              id: "protocol",
              label: "Protocoles",
              content: (
                <ListTable
                  title="Protocole"
                  metric="Sessions"
                  rows={data.protocol_split.map((p) => ({
                    key: p.protocol,
                    label: <span>{p.protocol.toUpperCase()}</span>,
                    value: p.n,
                    onClick: () => setFilter("protocol", p.protocol),
                  }))}
                />
              ),
            },
          ]}
        />
      </div>

      <div className="panel-row">
        <TabsPanel
          title="Commandes"
          tabs={[
            {
              id: "commands",
              label: "Les plus exécutées",
              content: (
                <ListTable
                  title="Commande"
                  metric="Exécutions"
                  rows={data.top_commands.map((c) => ({
                    key: c.input_text,
                    label: <span className="mono">{c.input_text}</span>,
                    title: c.input_text,
                    value: c.n,
                    onClick: () => navigate(sessionsUrl({ ...sessionFilters, command: c.input_text })),
                  }))}
                />
              ),
            },
          ]}
        />
        <TabsPanel
          title="Défense"
          tabs={[
            {
              id: "bans",
              label: "Bans fail2ban",
              content: data.bans_timeline.length ? (
                <div className="chart-container small">
                  <BansBarChart
                    bansTimeline={data.bans_timeline}
                    onBarClick={(bucket) => navigate(sessionsUrl(bucketRangeToDates(bucket, bucket)))}
                  />
                </div>
              ) : (
                <EmptyState message="Aucun ban sur la période" />
              ),
            },
            {
              id: "duration",
              label: "Durée des sessions",
              content: (
                <ListTable
                  title="Durée"
                  metric="Sessions"
                  rows={data.duration_distribution
                    .filter((d) => d.n > 0)
                    .map((d) => ({ key: d.bucket, label: <span>{d.bucket}</span>, value: d.n }))}
                />
              ),
            },
          ]}
        />
      </div>

      <div className="panel-row two-one">
        <section className="panel panel-flush">
          <WorldMap
            countries={data.countries}
            onCountryClick={(c) => setFilter("country", c.country)}
          />
        </section>
        <section className="panel">
          <h2>Trafic</h2>
          {heatmap.isPending ? (
            <SkeletonBlock rows={4} />
          ) : heatmap.isError ? (
            <ErrorState message="Erreur de chargement, réessaie." onRetry={() => heatmap.refetch()} />
          ) : heatmap.data.cells.length ? (
            <WeeklyTraffic cells={heatmap.data.cells} />
          ) : (
            <EmptyState message="Aucune donnée" />
          )}
        </section>
      </div>
    </>
  );
}

export function countryRows(
  data: Pick<OverviewData, "countries">,
  setFilter: (key: "country", value: string) => void,
  limit = 10
): ListRow[] {
  return data.countries.slice(0, limit).map((c) => ({
    key: c.country,
    label: (
      <>
        <span className="flag">{flagEmoji(c.country_code)}</span>
        <span>{countryLabel(c.country_code, c.country)}</span>
      </>
    ),
    value: c.n,
    onClick: () => setFilter("country", c.country),
  }));
}

function suggestionsFrom(data: OverviewData): Partial<Record<keyof Filters, string[]>> {
  return {
    country: data.countries.map((c) => c.country),
    protocol: data.protocol_split.map((p) => p.protocol),
    ip: data.top_offenders.map((o) => o.src_ip),
    username: data.top_usernames.map((u) => u.value),
  };
}
