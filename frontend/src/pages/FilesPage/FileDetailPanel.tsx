import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Link as LinkIcon, X } from "lucide-react";
import { useFileDetail } from "../../api/files";
import type { FileDetail } from "../../api/types";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { formatNumber, formatShare } from "../../utils/format";
import { formatTimestamp } from "../../utils/formatDate";
import { useCopy } from "../../utils/useCopy";
import { FileActions, KindBadge, formatBytes } from "./fileLabels";

type FileTab = "sessions" | "sources" | "ips";

function PanelBody({ data, closeRef, onClose }: {
  data: FileDetail;
  closeRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<FileTab>("sessions");
  const [copied, copy] = useCopy();
  const tabs: { id: FileTab; label: string; count: number }[] = [
    { id: "sessions", label: "Sessions récentes", count: data.recent_events.length },
    { id: "sources", label: "Sources", count: data.sources.length },
    { id: "ips", label: "IP principales", count: data.top_ips.length },
  ];

  return (
    <>
      <div className="panel-header session-panel-header">
        <h2 id="file-panel-title">
          Fichier <span className="mono">{data.shasum.slice(0, 12)}</span>
        </h2>
        <button ref={closeRef} className="btn-icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <div className="session-toolbar">
        <div className="session-panel-sub">
          {data.kinds.map((k) => (
            <KindBadge key={k} kind={k} />
          ))}
          <span className="cell-muted">
            {formatTimestamp(data.first_seen)} → {formatTimestamp(data.last_seen)}
          </span>
        </div>
        <div className="session-panel-actions">
          <button className="btn" onClick={() => copy("link", window.location.href)}>
            {copied === "link" ? <Check /> : <LinkIcon />} {copied === "link" ? "Copié" : "Copier le lien"}
          </button>
          <FileActions shasum={data.shasum} stored={data.size != null} />
        </div>
      </div>

      <div className="file-hash">
        <span className="metric-label">SHA-256</span>
        <code className="mono">{data.shasum}</code>
        <button className="btn-icon btn-copy" aria-label="Copier le SHA-256" onClick={() => copy("sha", data.shasum)}>
          {copied === "sha" ? <Check /> : <Copy />}
        </button>
      </div>

      <div className="session-metrics">
        <div className="metric-card">
          <div className="metric-label">Taille</div>
          <div className="metric-value">{formatBytes(data.size)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sessions</div>
          <div className="metric-value">{formatNumber(data.sessions)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">IP distinctes</div>
          <div className="metric-value">{formatNumber(data.ips)}</div>
        </div>
      </div>
      {data.size == null ? (
        <p className="cell-muted file-note">Cowrie n'a pas gardé de copie de ce contenu : pas de zip possible.</p>
      ) : (
        <p className="cell-muted file-note">Zip chiffré, mot de passe « infected ». À n'ouvrir que dans une VM jetable.</p>
      )}

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
            <span className="tab-count">{formatNumber(t.count)}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "sessions" && (
          <ul className="files-list">
            {data.recent_events.map((e, i) => (
              <li key={i}>
                <div className="files-list-head">
                  <KindBadge kind={e.kind} />
                  <Link className="mono" to={`?file=${data.shasum}&session=${encodeURIComponent(e.session_id)}`}>
                    {e.session_id}
                  </Link>
                  {e.src_ip && (
                    <Link className="mono" to={`/ip/${encodeURIComponent(e.src_ip)}`}>
                      {e.src_ip}
                    </Link>
                  )}
                  <span className="mono cell-muted">{formatTimestamp(e.timestamp)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {tab === "sources" && (
          <ul className="share-rows">
            {data.sources.map((s, i) => (
              <li key={i}>
                <i className="share-bar" style={{ width: `${Math.max((s.events / data.events) * 100, 0.5)}%` }} />
                <span className="share-rows-label mono" title={s.url || s.filename}>
                  {s.url || s.filename || "(sans nom)"}
                </span>
                <span className="cell-num">{formatNumber(s.events)}</span>
                <span className="cell-pct">{formatShare(s.events / data.events)}</span>
              </li>
            ))}
          </ul>
        )}
        {tab === "ips" && (
          <ul className="share-rows">
            {data.top_ips.map((ip) => (
              <li key={ip.ip}>
                <i className="share-bar" style={{ width: `${Math.max((ip.sessions / data.sessions) * 100, 0.5)}%` }} />
                <span className="share-rows-label">
                  <Link className="mono" to={`/ip/${encodeURIComponent(ip.ip)}`}>
                    {ip.ip}
                  </Link>
                </span>
                <span className="cell-num">{formatNumber(ip.sessions)}</span>
                <span className="cell-pct">{formatShare(ip.sessions / data.sessions)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function FileDetailPanel({ shasum, onClose }: { shasum: string; onClose: () => void }) {
  const { data, isPending, isError, refetch } = useFileDetail(shasum);
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
      <aside className="session-panel" role="dialog" aria-modal="true" aria-labelledby="file-panel-title">
        {isPending ? (
          <SkeletonBlock rows={6} />
        ) : isError ? (
          <ErrorState message="Fichier introuvable ou erreur de chargement." onRetry={() => refetch()} />
        ) : (
          <PanelBody key={shasum} data={data} closeRef={closeRef} onClose={onClose} />
        )}
      </aside>
    </>,
    document.body
  );
}
