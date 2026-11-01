function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function localMidnight(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatDaysAgo(isoTimestamp: string, now: Date = new Date()): string {
  // Calendar days, rounded: a DST change makes two midnights 23 or 25 h apart.
  const days = Math.round((localMidnight(now) - localMidnight(new Date(isoTimestamp))) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}

export function formatTimestamp(isoTimestamp: string): string {
  // fail2ban's own log lines use "YYYY-MM-DD HH:MM:SS,mmm" (space + comma-decimal),
  // which Date can't parse — normalize to a Date-parseable form. Already-ISO
  // timestamps (cowrie/journalctl sources, which contain "T") pass through untouched.
  const normalized = isoTimestamp.includes("T")
    ? isoTimestamp
    : isoTimestamp.replace(" ", "T").replace(",", ".");
  const date = new Date(normalized);
  return isToday(date)
    ? date.toLocaleTimeString("fr-FR")
    : date.toLocaleString("fr-FR");
}
