import { Download, ExternalLink } from "lucide-react";
import { Badge } from "../../components/Badge";
import { fileDownloadUrl, virusTotalUrl } from "../../api/files";
import type { FileKind } from "../../api/types";

export const KIND_LABELS: Record<FileKind, { label: string; hint: string }> = {
  download: { label: "Téléchargé", hint: "Récupéré depuis une URL (wget, curl…)" },
  redirect: { label: "Écrit", hint: "Écrit par une redirection shell (echo … > fichier)" },
  upload: { label: "Déposé", hint: "Envoyé par l'attaquant (SFTP ou scp)" },
  failed: { label: "Échec", hint: "Téléchargement tenté mais échoué" },
};

export function KindBadge({ kind }: { kind: FileKind }) {
  const { label, hint } = KIND_LABELS[kind] ?? { label: kind, hint: "" };
  return <Badge label={label} tone={kind === "failed" ? "neutral" : "warning"} title={hint} />;
}

export function formatBytes(size: number | null | undefined): string {
  if (size == null) return "—";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(".", ",")} Ko`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** VirusTotal lookup (hash only, nothing is uploaded) and the "infected" zip when Cowrie kept a copy. */
export function FileActions({ shasum, stored }: { shasum: string; stored: boolean }) {
  return (
    <span className="file-actions">
      <a
        className="btn"
        href={virusTotalUrl(shasum)}
        target="_blank"
        rel="noopener noreferrer"
        title="Chercher ce SHA-256 sur VirusTotal (seul le hash est envoyé)"
      >
        <ExternalLink /> VirusTotal
      </a>
      {stored && (
        <a className="btn" href={fileDownloadUrl(shasum)} download title="Zip chiffré, mot de passe : infected">
          <Download /> Zip
        </a>
      )}
    </span>
  );
}
