import { Link, useSearchParams } from "react-router-dom";
import { Fingerprint } from "lucide-react";
import { CAMPAIGNS_PAGE_SIZE, useCampaigns } from "../../api/campaigns";
import type { Campaign, CampaignSort } from "../../api/types";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";
import { Sparkline } from "../../components/Sparkline";
import { formatNumber } from "../../utils/format";
import { CampaignDetailPanel } from "./CampaignDetailPanel";

const TABS: { sort: CampaignSort; label: string }[] = [
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

function PseudoRow({ label, ips, sessions }: { label: string; ips: number | null; sessions: number }) {
  return (
    <tr className="pseudo-row">
      <td className="mono command-cell">{label}</td>
      <td className="cell-num cell-muted">{ips == null ? "—" : formatNumber(ips)}</td>
      <td />
      <td className="cell-num">{formatNumber(sessions)}</td>
      <td className="cell-pct">—</td>
    </tr>
  );
}

export function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get("sort");
  const sort: CampaignSort = TABS.some((t) => t.sort === sortParam) ? (sortParam as CampaignSort) : "sessions";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const openId = searchParams.get("campaign");

  const { data, isPending, isError, refetch } = useCampaigns({ sort, page });

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

  if (isPending) return <SkeletonBlock rows={8} />;
  if (isError) {
    return <ErrorState message="Erreur de chargement, réessaie." onRetry={() => refetch()} />;
  }

  const { totals } = data;
  const totalPages = Math.max(1, Math.ceil(data.total / CAMPAIGNS_PAGE_SIZE));

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
        <MetricCard label="Campagnes" value={formatNumber(totals.campaigns)} note="empreintes partagées par 2 sessions ou plus" />
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
          {TABS.map((t) => (
            <button
              key={t.sort}
              role="tab"
              aria-selected={t.sort === sort}
              className={`tab${t.sort === sort ? " active" : ""}`}
              onClick={() => update({ sort: t.sort, page: null })}
            >
              {t.label}
            </button>
          ))}
        </div>
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
            {data.items.length ? (
              data.items.map((c) => (
                <CampaignRow key={c.id} campaign={c} href={urlWith({ campaign: c.id })} />
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  <EmptyState message="Aucune campagne" />
                </td>
              </tr>
            )}
            <PseudoRow label="Sessions uniques" ips={null} sessions={totals.unique_sessions} />
            <PseudoRow
              label="Login seul (pas de shell)"
              ips={totals.login_only.ips}
              sessions={totals.login_only.sessions}
            />
          </tbody>
        </table>
        <div className="table-footer">
          <span className="result-count">{formatNumber(data.total)} campagnes</span>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => update({ page: String(page - 1) })}
            onNext={() => update({ page: String(page + 1) })}
          />
        </div>
      </section>
      {openId && <CampaignDetailPanel campaignId={openId} onClose={() => update({ campaign: null })} />}
    </>
  );
}
