export function formatLongNumber(value: number): string {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
  if (abs >= 1e5) return `${Math.round(n / 1e3)}k`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return String(Math.round(n));
}

/** Axis ticks: "9k" rather than "9.00k". */
export function formatAxisNumber(value: number): string {
  return formatLongNumber(value).replace(/\.0+(?=[kmb]$)|(\.\d*?)0+(?=[kmb]$)/, "$1");
}

export function formatNumber(value: number): string {
  return (Number(value) || 0).toLocaleString("fr-FR");
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous == null) return null;
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["fr"], { type: "region" });
} catch {
  regionNames = null;
}

export function countryLabel(code: string | null | undefined, fallback: string | null | undefined): string {
  if (code && regionNames) {
    try {
      return regionNames.of(code) ?? fallback ?? code;
    } catch {
      // Unknown or reserved code: fall through to the raw name.
    }
  }
  return fallback ?? code ?? "Inconnu";
}

export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "🏳";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** A 0–1 share as a whole percent, "<1%" rather than a misleading "0%". */
export function formatShare(share: number): string {
  const pct = share * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}
