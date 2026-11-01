import { Link, useSearchParams } from "react-router-dom";
import { Fingerprint } from "lucide-react";
import { CAMPAIGNS_PAGE_SIZE, useCampaigns, useUniqueSessions } from "../../api/campaigns";
import type { Campaign, CampaignSort, UniqueSession } from "../../api/types";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";
import { Sparkline } from "../../components/Sparkline";
import { formatDuration, formatNumber } from "../../utils/format";
import { formatTimestamp } from "../../utils/formatDate";
import { SessionDetailPanel } from "../SessionsPage/SessionDetailPanel";
import { CampaignDetailPanel } from "./CampaignDetailPanel";

const UNIQUE_VIEW = "unique";

const SORT_TABS: { sort: CampaignSort; label: string }[] = [
  { sort: "sessions", label: "Par sessions" },
  { sort: "ips", label: "Par IP" },
  { sort: "first_seen", label: "Nouvelles" },
  { sort: "last_seen", label: "Actives récemment" },
];

export function formatShare(share: number): string {
  const pct = share * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

function CampaignRow({ campaign, href }: { campaign: Campaign; href: string }) {
  const command = campaign.sample_command ?? "(aucune commande)";
  return (
    <tr>
      <td className="mono command-cell share-cell">
        <i className="share-bar" style={{ width: `${Math.max(campaign.share * 100, 0.5)}%` }} />
        <Link to={href} title={command}>
          {command}
        </Link>
        {campaign.variants > 1 && (
          <span className="variant-count">{formatNumber(campaign.variants)} variantes</span>
        )}
      </td>
      <td className="cell-num cell-muted">{formatNumber(campaign.ips)}</td>
      <td>
        <Sparkline values={campaign.activity} />
      </td>
      <td className="cell-num">{formatNumber(campaign.sessions)}</td>
      <td className="cell-pct">{formatShare(campaign.share)}</td>
    </tr>
  );
}

function PseudoRow({
  label,
  ips,
  sessions,
  href,
}: {
  label: string;
  ips: number | null;
  sessions: number;
  href?: string;
}) {
  return (
    <tr className="pseudo-row">
      <td className="mono command-cell share-cell">{href ? <Link to={href}>{label}</Link> : label}</td>
      <td className="cell-num cell-muted">{ips == null ? "—" : formatNumber(ips)}</td>
      <td />
      <td className="cell-num">{formatNumber(sessions)}</td>
      <td className="cell-pct">—</td>
    </tr>
  );
}

function UniqueSessionRow({ session, href }: { session: UniqueSession; href: string }) {
  const command = session.first_command ?? "(aucune commande)";
  return (
    <tr>
      <td className="mono command-cell share-cell">
        <Link to={href} title={command}>
          {command}
        </Link>
      </td>
      <td className="mono">
        <Link to={`/ip/${encodeURIComponent(session.src_ip)}`}>{session.src_ip}</Link>
      </td>
      <td className="mono cell-muted">{formatTimestamp(session.connect_time)}</td>
      <td className="cell-num cell-muted">{formatDuration(session.duration_ms)}</td>
      <td className="cell-num">{formatNumber(session.commands)}</td>
    </tr>
  );
}

export function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get("sort");
  const sort: CampaignSort = SORT_TABS.some((t) => t.sort === sortParam) ? (sortParam as CampaignSort) : "sessions";
  const uniqueView = searchParams.get("view") === UNIQUE_VIEW;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const openCampaign = searchParams.get("campaign");
  const openSession = searchParams.get("session");

  // The campaign list also carries the totals shown in the cards, so it loads in both views.
  const campaigns = useCampaigns({ sort, page: uniqueView ? 1 : page });
  const unique = useUniqueSessions({ page, enabled: uniqueView });

  function urlWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) params.delete(key);
      else params.set(key, value);
    }
    return `?${params.toString()}`;
  }

  function update(changes: Record<string, string | null>) {
    setSearchParams(new URLSearchParams(urlWith(changes).slice(1)));
  }

  const listQuery = uniqueView ? unique : campaigns;
  if (campaigns.isPending || listQuery.isPending) return <SkeletonBlock rows={8} />;
  if (campaigns.isError || listQuery.isError) {
    return (
      <ErrorState
        message="Erreur de chargement, réessaie."
        onRetry={() => {
          campaigns.refetch();
          if (uniqueView) unique.refetch();
        }}
      />
    );
  }

  const { totals } = campaigns.data;
  const listTotal = uniqueView ? unique.data!.total : campaigns.data.total;
  const totalPages = Math.max(1, Math.ceil(listTotal / CAMPAIGNS_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={
          <>
            <Fingerprint />
            Campagnes
          </>
        }
      />
      <div className="metrics-bar">
        <MetricCard label="Campagnes" value={formatNumber(totals.campaigns)} note="comportements vus dans 2 sessions ou plus" />
        <MetricCard
          label="Concentration"
          value={`${Math.round(totals.top_share * 100)} %`}
          note="des sessions dans la campagne n°1"
        />
        <MetricCard label="Nouvelles" value={formatNumber(totals.new_7d)} note="vues pour la 1re fois sur 7 j" />
        <MetricCard
          label="Login seul"
          value={formatNumber(totals.login_only.sessions)}
          note="sessions sans shell"
        />
      </div>
      <section className="panel table-panel">
        <div className="tabs" role="tablist">
          {SORT_TABS.map((t) => {
            const active = !uniqueView && t.sort === sort;
            return (
              <button
                key={t.sort}
                role="tab"
                aria-selected={active}
                className={`tab${active ? " active" : ""}`}
                onClick={() => update({ sort: t.sort, view: null, page: null })}
              >
                {t.label}
              </button>
            );
          })}
          <button
            role="tab"
            aria-selected={uniqueView}
            className={`tab${uniqueView ? " active" : ""}`}
            onClick={() => update({ view: UNIQUE_VIEW, page: null })}
          >
            Sessions uniques
          </button>
        </div>
        {uniqueView ? (
          <table className="plain-table campaigns-table">
            <thead>
              <tr>
                <th>Première commande</th>
                <th>IP</th>
                <th>Date</th>
                <th className="cell-num">Durée</th>
                <th className="cell-num">Commandes</th>
              </tr>
            </thead>
            <tbody>
              {unique.data!.items.length ? (
                unique.data!.items.map((s) => (
                  <UniqueSessionRow key={s.session_id} session={s} href={urlWith({ session: s.session_id })} />
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <EmptyState message="Aucune session unique" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="plain-table campaigns-table">
            <thead>
              <tr>
                <th>Commande type</th>
                <th className="cell-num">IP</th>
                <th>30 j</th>
                <th className="cell-num">Sessions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {campaigns.data.items.length ? (
                campaigns.data.items.map((c) => (
                  <CampaignRow key={c.id} campaign={c} href={urlWith({ campaign: c.id })} />
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <EmptyState message="Aucune campagne" />
                  </td>
                </tr>
              )}
              <PseudoRow
                label="Sessions uniques"
                ips={null}
                sessions={totals.unique_sessions}
                href={urlWith({ view: UNIQUE_VIEW, page: null, campaign: null })}
              />
              <PseudoRow
                label="Login seul (pas de shell)"
                ips={totals.login_only.ips}
                sessions={totals.login_only.sessions}
              />
            </tbody>
          </table>
        )}
        <div className="table-footer">
          <span className="result-count">
            {formatNumber(listTotal)} {uniqueView ? "sessions uniques" : "campagnes"}
          </span>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => update({ page: String(page - 1) })}
            onNext={() => update({ page: String(page + 1) })}
          />
        </div>
      </section>
      {openCampaign && (
        <CampaignDetailPanel campaignId={openCampaign} onClose={() => update({ campaign: null })} />
      )}
      {openSession && <SessionDetailPanel sessionId={openSession} onClose={() => update({ session: null })} />}
    </>
  );
}
