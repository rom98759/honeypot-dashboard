import { TriangleAlert } from "lucide-react";
import { useHealth } from "../api/health";
import type { HealthSource } from "../api/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function describe(source: HealthSource): string {
  if (!source.file_present) return `${source.source} : fichier introuvable`;
  return `${source.source} : ${formatBytes(source.lag_bytes ?? 0)} non lus`;
}

export function HealthBanner() {
  const { data } = useHealth();
  // A side widget: an unexpected body must hide the banner, never break the page.
  const stalled = (data?.sources ?? []).filter((s) => s.stalled);
  if (stalled.length === 0) return null;
  return (
    <div className="health-banner" role="status">
      <TriangleAlert aria-hidden="true" />
      <div>
        <strong>Ingestion en retard : les chiffres de ces sources peuvent être incomplets.</strong>
        <ul>
          {stalled.map((s) => (
            <li key={s.source}>{describe(s)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
