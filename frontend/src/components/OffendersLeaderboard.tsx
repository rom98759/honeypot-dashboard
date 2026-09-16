import { Link } from "react-router-dom";
import { formatTimestamp } from "../utils/formatDate";

export interface Offender {
  src_ip: string;
  n: number;
  country: string | null;
  last_seen: string;
}

export function OffendersLeaderboard({ offenders }: { offenders: Offender[] }) {
  return (
    <table className="plain-table">
      <thead>
        <tr>
          <th>IP</th>
          <th>Pays</th>
          <th>Sessions</th>
          <th>Dernière vue</th>
        </tr>
      </thead>
      <tbody>
        {offenders.map((o) => (
          <tr key={o.src_ip}>
            <td className="mono">
              <Link to={`/ip/${encodeURIComponent(o.src_ip)}`} className="ip-link">
                {o.src_ip}
              </Link>
            </td>
            <td>{o.country ?? "—"}</td>
            <td>{o.n}</td>
            <td className="mono">{formatTimestamp(o.last_seen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
