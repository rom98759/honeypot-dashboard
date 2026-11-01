export type BadgeTone = "danger" | "warning" | "neutral" | "success";

export function Badge({ label, tone, title }: { label: string; tone: BadgeTone; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {label}
    </span>
  );
}

// Cowrie lets attackers in on purpose; red here would read as a real compromise.
export const ACCEPTED_LOGIN_HINT =
  "Login accepté par le honeypot (leurre) : ce n'est pas une compromission d'un vrai système.";

export function AcceptedLoginBadge() {
  return <Badge label="Accepté" tone="neutral" title={ACCEPTED_LOGIN_HINT} />;
}
