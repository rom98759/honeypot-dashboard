function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
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
