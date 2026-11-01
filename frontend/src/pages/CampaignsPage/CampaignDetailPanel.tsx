import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Link as LinkIcon, X } from "lucide-react";
import { useCampaignDetail } from "../../api/campaigns";
import type { CampaignDetail } from "../../api/types";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { Badge } from "../../components/Badge";
import { ReplayPlayer } from "../../components/ReplayPlayer";
import { formatNumber, formatShare } from "../../utils/format";
import { formatTimestamp } from "../../utils/formatDate";
import { useCopy } from "../../utils/useCopy";

type CampaignTab = "sample" | "commands" | "ips" | "variants";

function OriginCard({ data }: { data: CampaignDetail }) {
  return (
    <dl className="origin-card">
      <dt>ASN dominant</dt>
      <dd>
        {data.top_asn ? (
          <>
            AS{data.top_asn.asn} {data.top_asn.asn_org ?? ""}
            <span className="cell-muted"> · {formatShare(data.top_asn.share)}</span>
          </>
        ) : (
          "-"
        )}
      </dd>
      <dt>/24 dominant</dt>
      <dd>
        {data.top_prefix ? (
          <>
            <span className="mono">{data.top_prefix.prefix}</span>
            <span className="cell-muted"> · {formatShare(data.top_prefix.share)}</span>
          </>
        ) : (
          "-"
        )}
      </dd>
    </dl>
  );
}

function ShareRows({ rows, total }: { rows: { key: string; label: React.ReactNode; sessions: number }[]; total: number }) {
  return (
    <ul className="share-rows">
      {rows.map((r) => (
        <li key={r.key}>
          <i className="share-bar" style={{ width: `${Math.max((r.sessions / total) * 100, 0.5)}%` }} />
          <span className="share-rows-label">{r.label}</span>
          <span className="cell-num">{formatNumber(r.sessions)}</span>
          <span className="cell-pct">{formatShare(r.sessions / total)}</span>
        </li>
      ))}
    </ul>
  );
}

function PanelBody({ data, closeRef, onClose }: {
  data: CampaignDetail;
  closeRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<CampaignTab>("sample");
  const [copied, copy] = useCopy();
  const tabs: { id: CampaignTab; label: string; count?: number }[] = [
    { id: "sample", label: "Session exemple" },
    { id: "commands", label: "Commandes", count: data.commands.length },
    { id: "ips", label: "IP principales", count: data.top_ips.length },
  ];
  if (data.variant_count > 1) tabs.push({ id: "variants", label: "Variantes", count: data.variant_count });

  return (
    <>
      <div className="panel-header session-panel-header">
        <h2 id="campaign-panel-title">
          Campagne <span className="mono">{data.id.slice(0, 8)}</span>
        </h2>
        <button ref={closeRef} className="btn-icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <div className="session-toolbar">
        <div className="session-panel-sub">
          {data.variant_count > 1 && <Badge label={`${data.variant_count} variantes`} tone="neutral" />}
          <span className="cell-muted">
            {formatTimestamp(data.first_seen)} → {formatTimestamp(data.last_seen)}
          </span>
        </div>
        <div className="session-panel-actions">
          <button className="btn" onClick={() => copy("link", window.location.href)}>
            {copied === "link" ? <Check /> : <LinkIcon />} {copied === "link" ? "Copié" : "Copier le lien"}
          </button>
        </div>
      </div>

      <pre className="typical-command">
        <code>{data.commands[0]?.input_text ?? "(aucune commande)"}</code>
      </pre>

      <div className="session-metrics">
        <div className="metric-card">
          <div className="metric-label">Sessions</div>
          <div className="metric-value">{formatNumber(data.sessions)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">IP distinctes</div>
          <div className="metric-value">{formatNumber(data.ips)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Commandes</div>
          <div className="metric-value">{formatNumber(data.commands.length)}</div>
        </div>
      </div>

      <OriginCard data={data} />

      <div className="tabs panel-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null && <span className="tab-count">{formatNumber(t.count)}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "sample" && (
          <div className="sample-session">
            <Link to={`?session=${encodeURIComponent(data.sample_session_id)}`}>
              Ouvrir la session <span className="mono">{data.sample_session_id}</span> →
            </Link>
            <ReplayPlayer sessionId={data.sample_session_id} />
          </div>
        )}
        {tab === "commands" &&
          (data.commands.length ? (
            <ul className="commands-list">
              {data.commands.map((c, i) => (
                <li key={i}>
                  <span className="mono">{i + 1}</span>
                  <code>{c.input_text}</code>
                  <button
                    className="btn-icon btn-copy"
                    aria-label={`Copier la commande ${i + 1}`}
                    onClick={() => copy(`cmd-${i}`, c.input_text)}
                  >
                    {copied === `cmd-${i}` ? <Check /> : <Copy />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cell-muted">Aucune commande.</p>
          ))}
        {tab === "ips" && (
          <ShareRows
            total={data.sessions}
            rows={data.top_ips.map((ip) => ({
              key: ip.ip,
              sessions: ip.sessions,
              label: (
                <Link className="mono" to={`/ip/${encodeURIComponent(ip.ip)}`}>
                  {ip.ip}
                </Link>
              ),
            }))}
          />
        )}
        {tab === "variants" && (
          <ShareRows
            total={data.sessions}
            rows={data.variants.map((v) => ({
              key: v.id,
              sessions: v.sessions,
              label: <span className="mono">{v.id.slice(0, 12)}</span>,
            }))}
          />
        )}
      </div>
    </>
  );
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
          <PanelBody key={campaignId} data={data} closeRef={closeRef} onClose={onClose} />
        )}
      </aside>
    </>,
    document.body
  );
}
