import { createPortal } from "react-dom";
import { useEffect } from "react";
import { X } from "lucide-react";
import { useSessionDetail } from "../../api/sessions";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { ErrorState } from "../../components/ErrorState";
import { Badge } from "../../components/Badge";
import { ReplayPlayer } from "../../components/ReplayPlayer";
import type { Session } from "../../api/types";
import { formatTimestamp } from "../../utils/formatDate";

function formatDuration(ms: number | null): string {
  return ms ? `${Math.round(ms / 1000)}s` : "-";
}

function SessionMeta({ session }: { session: Session }) {
  const address = session.src_port ? `${session.src_ip}:${session.src_port}` : session.src_ip;
  let authBadge;
  if (session.login_username == null) {
    authBadge = <Badge label="Aucune tentative" tone="neutral" />;
  } else if (session.login_success === 1) {
    authBadge = <Badge label="Réussie" tone="danger" />;
  } else {
    authBadge = <Badge label="Échouée" tone="neutral" />;
  }
  return (
    <dl className="session-meta">
      <dt>Adresse</dt>
      <dd className="mono">{address}</dd>
      <dt>Protocole</dt>
      <dd>{session.protocol || "-"}</dd>
      <dt>Login tenté</dt>
      <dd className="mono">{session.login_username || "-"}</dd>
      <dt>Mot de passe tenté</dt>
      <dd className="mono">{session.login_password || "-"}</dd>
      <dt>Authentification</dt>
      <dd>{authBadge}</dd>
      <dt>Connexion</dt>
      <dd className="mono">{formatTimestamp(session.connect_time)}</dd>
      <dt>Déconnexion</dt>
      <dd className="mono">{session.close_time ? formatTimestamp(session.close_time) : "-"}</dd>
      <dt>Durée</dt>
      <dd>{formatDuration(session.duration_ms)}</dd>
    </dl>
  );
}

export function SessionDetailPanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { data, isPending, isError, refetch } = useSessionDetail(sessionId);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return createPortal(
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="session-panel">
        {isPending ? (
          <SkeletonBlock rows={6} />
        ) : isError ? (
          <ErrorState message="Erreur de chargement de la session." onRetry={() => refetch()} />
        ) : (
          <>
            <div className="panel-header">
              <h2 className="mono">{data.session.session_id}</h2>
              <button className="btn-icon" onClick={onClose}>
                <X />
              </button>
            </div>
            <SessionMeta session={data.session} />
            <ReplayPlayer sessionId={sessionId} />
            <h3>Commandes</h3>
            <ul className="commands-list">
              {data.commands.length ? (
                data.commands.map((c, i) => (
                  <li key={i}>
                    <span className="mono">{formatTimestamp(c.timestamp)}</span>
                    <code>{c.input_text}</code>
                  </li>
                ))
              ) : (
                <li>Aucune commande</li>
              )}
            </ul>
          </>
        )}
      </aside>
    </>,
    document.body
  );
}
