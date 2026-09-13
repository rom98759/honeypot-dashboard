function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return isToday(date)
    ? date.toLocaleTimeString("fr-FR")
    : date.toLocaleString("fr-FR");
}
