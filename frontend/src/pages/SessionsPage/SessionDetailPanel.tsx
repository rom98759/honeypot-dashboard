import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Download, Link as LinkIcon, X } from "lucide-react";
import { useSessionDetail } from "../../api/sessions";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { AcceptedLoginBadge, Badge } from "../../components/Badge";
import { ReplayPlayer } from "../../components/ReplayPlayer";
import type { Command, Session, SessionDetail } from "../../api/types";
import { formatTimestamp } from "../../utils/formatDate";
import { useCopy } from "../../utils/useCopy";
import { countryLabel, flagEmoji, formatDuration, formatNumber } from "../../utils/format";

function authBadge(session: Session) {
  if (session.login_username == null) return <Badge label="Aucune tentative" tone="neutral" />;
  if (session.login_success === 1) return <AcceptedLoginBadge />;
  return <Badge label="Échouée" tone="neutral" />;
}

/** "+01:05" from the connection, easier to follow than absolute timestamps. */
export function relativeTime(start: string, at: string): string {
  const diff = Math.max(0, Math.round((Date.parse(at) - Date.parse(start)) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `+${h}:${mmss}` : `+${mmss}`;
}

function ExportMenu({ detail }: { detail: SessionDetail }) {
  const [open, setOpen] = useState(false);
  const id = encodeURIComponent(detail.session.session_id);
  return (
    <div className="export-menu">
      <button className="btn btn-primary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download /> Exporter
      </button>
      {open && (
        <div className="export-popover" role="menu">
          <a role="menuitem" href={`/api/sessions/${id}/export`} download onClick={() => setOpen(false)}>
            Session (JSON)
            <small>métadonnées, IP, commandes</small>
          </a>
          {detail.ttylogs.length > 0 && (
            <a role="menuitem" href={`/api/sessions/${id}/replay?download=1`} download onClick={() => setOpen(false)}>
              Replay (.cast)
              <small>lisible avec asciinema play</small>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function IpCard({ detail }: { detail: SessionDetail }) {
  const { session, ip, campaign } = detail;
  const address = session.src_port ? `${ip.ip}:${session.src_port}` : ip.ip;
  const where = ip.country || ip.country_code ? `${flagEmoji(ip.country_code)} ${countryLabel(ip.country_code, ip.country)}` : "Pays inconnu";
  return (
    <div className="ip-card">
      <div className="ip-card-main">
        <span className="mono ip-card-address">{address}</span>
        <span>
          {where}
          {ip.asn != null && ` · AS${ip.asn} ${ip.asn_org ?? ""}`}
        </span>
      </div>
      <div className="ip-card-tags">
        {ip.protected && <Badge label="Protégée" tone="neutral" />}
        {ip.banned ? <Badge label="Bannie" tone="danger" /> : <span className="cell-muted">Non bannie</span>}
        {campaign ? (
          <Link to={`/campaigns?campaign=${encodeURIComponent(campaign.id)}`}>
            Campagne · {formatNumber(campaign.sessions)} sessions
          </Link>
        ) : (
          detail.ttylogs.length > 0 && <span className="cell-muted">Session unique</span>
        )}
      </div>
      <Link className="ip-card-link" to={`/ip/${encodeURIComponent(ip.ip)}`}>
        Page IP →
      </Link>
    </div>
  );
}

function CommandsTab({ start, commands }: { start: string; commands: Command[] }) {
  const [copied, copy] = useCopy();
  if (!commands.length) return <p className="cell-muted">Aucune commande.</p>;
  return (
    <ul className="commands-list">
      {commands.map((c, i) => (
        <li key={i}>
          <span className="mono" title={formatTimestamp(c.timestamp)}>
            {relativeTime(start, c.timestamp)}
          </span>
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
  );
}

function PanelBody({ detail, closeRef, onClose }: {
  detail: SessionDetail;
  closeRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const { session, commands } = detail;
  const hasReplay = detail.ttylogs.length > 0;
  const [tab, setTab] = useState<"replay" | "commands">(hasReplay ? "replay" : "commands");
  const [copied, copy] = useCopy();

  return (
    <>
      <div className="panel-header session-panel-header">
        <h2 id="session-panel-title" className="mono">{session.session_id}</h2>
        <button ref={closeRef} className="btn-icon" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <div className="session-toolbar">
        <div className="session-panel-sub">
          {session.protocol && <Badge label={session.protocol.toUpperCase()} tone="neutral" />}
          {authBadge(session)}
          <span className="cell-muted">
            {formatTimestamp(session.connect_time)}
            {session.close_time && ` → ${formatTimestamp(session.close_time)}`}
          </span>
        </div>
        <div className="session-panel-actions">
          <button className="btn" onClick={() => copy("link", window.location.href)}>
            {copied === "link" ? <Check /> : <LinkIcon />} {copied === "link" ? "Copié" : "Copier le lien"}
          </button>
          <ExportMenu detail={detail} />
        </div>
      </div>

      <div className="session-metrics">
        <div className="metric-card">
          <div className="metric-label">Durée</div>
          <div className="metric-value">{formatDuration(session.duration_ms)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Commandes</div>
          <div className="metric-value">{formatNumber(commands.length)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sessions de l'IP</div>
          <div className="metric-value">{formatNumber(detail.ip.sessions)}</div>
        </div>
      </div>

      <IpCard detail={detail} />

      <dl className="session-credentials">
        <dt>Identifiant</dt>
        <dd className="mono">{session.login_username ?? "-"}</dd>
        <dt>Mot de passe</dt>
        <dd className="mono">{session.login_password ?? "-"}</dd>
      </dl>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "replay"}
          className={`tab${tab === "replay" ? " active" : ""}`}
          onClick={() => setTab("replay")}
        >
          Replay
        </button>
        <button
          role="tab"
          aria-selected={tab === "commands"}
          className={`tab${tab === "commands" ? " active" : ""}`}
          onClick={() => setTab("commands")}
        >
          Commandes <span className="tab-count">{commands.length}</span>
        </button>
      </div>
      <div role="tabpanel">
        {tab === "replay" ? (
          hasReplay ? (
            <ReplayPlayer sessionId={session.session_id} />
          ) : (
            <p className="cell-muted">Pas d'enregistrement terminal : l'attaquant s'est arrêté au login.</p>
          )
        ) : (
          <CommandsTab start={session.connect_time} commands={commands} />
        )}
      </div>
    </>
  );
}

export function SessionDetailPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data, isPending, isError, refetch } = useSessionDetail(sessionId);
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
      <aside className="session-panel" role="dialog" aria-modal="true" aria-labelledby="session-panel-title">
        {isPending ? (
          <SkeletonBlock rows={6} />
        ) : isError ? (
          <ErrorState message="Erreur de chargement de la session." onRetry={() => refetch()} />
        ) : (
          <PanelBody key={sessionId} detail={data} closeRef={closeRef} onClose={onClose} />
        )}
      </aside>
    </>,
    document.body
  );
}
