import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useCampaignDetail } from "../../api/campaigns";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { ReplayPlayer } from "../../components/ReplayPlayer";
import { formatNumber } from "../../utils/format";
import { formatTimestamp } from "../../utils/formatDate";

function pct(share: number): string {
  return `${Math.round(share * 100)} %`;
}

export function CampaignDetailPanel({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { data, isPending, isError, refetch } = useCampaignDetail(campaignId);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [data]);

  return createPortal(
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="session-panel" role="dialog" aria-modal="true" aria-labelledby="campaign-panel-title">
        {isPending ? (
          <SkeletonBlock rows={6} />
        ) : isError ? (
          <ErrorState message="Campagne introuvable ou erreur de chargement." onRetry={() => refetch()} />
        ) : (
          <>
            <div className="panel-header">
              <div>
                <div className="cell-muted mono">campagne {data.id.slice(0, 8)}</div>
                <h2 id="campaign-panel-title" className="mono">
                  {data.commands[0]?.input_text ?? "(aucune commande)"}
                </h2>
              </div>
              <button ref={closeRef} className="btn-icon" onClick={onClose} aria-label="Fermer">
                <X />
              </button>
            </div>
            <dl className="session-meta">
              <dt>Sessions</dt>
              <dd>{formatNumber(data.sessions)}</dd>
              <dt>IP distinctes</dt>
              <dd>{formatNumber(data.ips)}</dd>
              <dt>ASN dominant</dt>
              <dd>
                {data.top_asn
                  ? `AS${data.top_asn.asn} ${data.top_asn.asn_org ?? ""} · ${pct(data.top_asn.share)}`
                  : "-"}
              </dd>
              <dt>/24 dominant</dt>
              <dd className="mono">
                {data.top_prefix ? `${data.top_prefix.prefix} · ${pct(data.top_prefix.share)}` : "-"}
              </dd>
              <dt>Première vue</dt>
              <dd className="mono">{formatTimestamp(data.first_seen)}</dd>
              <dt>Dernière vue</dt>
              <dd className="mono">{formatTimestamp(data.last_seen)}</dd>
            </dl>
            <h3>Session exemple</h3>
            <ReplayPlayer sessionId={data.sample_session_id} />
            <h3>Commandes</h3>
            <ul className="commands-list">
              {data.commands.length ? (
                data.commands.map((c, i) => (
                  <li key={i}>
                    <code>{c.input_text}</code>
                  </li>
                ))
              ) : (
                <li className="cell-muted">Aucune commande</li>
              )}
            </ul>
            <h3>IP principales</h3>
            <ul className="commands-list">
              {data.top_ips.map((ip) => (
                <li key={ip.ip}>
                  <Link className="mono" to={`/ip/${encodeURIComponent(ip.ip)}`}>
                    {ip.ip}
                  </Link>
                  <span className="cell-muted">{formatNumber(ip.sessions)} sessions</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </>,
    document.body
  );
}
