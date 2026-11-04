import { type FormEvent, useState } from "react";
import { Settings } from "lucide-react";
import { useAddAdminIp, useAdminIps, useRemoveAdminIp } from "../api/settings";
import { ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { ErrorState } from "../components/ErrorState";
import { formatTimestamp } from "../utils/formatDate";

function addErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return "Cette IP ou plage est déjà dans la liste.";
  if (error instanceof ApiError && error.status === 400) {
    return "IP ou plage invalide ou plus large que /16 (IPv4) ou /48 (IPv6).";
  }
  return "Échec de l'ajout, réessaie.";
}

export function SettingsPage() {
  const listing = useAdminIps();
  const add = useAddAdminIp();
  const remove = useRemoveAdminIp();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    add.mutate(
      { value: value.trim(), note: note.trim() },
      {
        onSuccess: () => {
          setValue("");
          setNote("");
        },
      }
    );
  }

  return (
    <>
      <PageHeader
        title={
          <>
            <Settings />
            Réglages
          </>
        }
      />
      <section className="panel">
        <h2>IP protégées</h2>
        <p className="cell-muted">
          Tes propres adresses : ni le bouton Bannir ni les bans automatiques de fail2ban (Cowrie, vrai SSH,
          récidive) ne les touchent. Une IP seule ou une plage CIDR jusqu'à /16 (par exemple{" "}
          <span className="mono">198.51.100.0/24</span>). La liste <span className="mono">/etc/honeypot/never-ban</span>{" "}
          du serveur s'y ajoute.
        </p>
        <form className="settings-form" onSubmit={handleSubmit}>
          <label>
            <span>IP ou plage</span>
            <input
              className="input mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="203.0.113.7 ou 203.0.113.0/24"
            />
          </label>
          <label>
            <span>Note</span>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="box, 4G, homelab…"
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={add.isPending}>
            Ajouter
          </button>
        </form>
        {add.isError ? <p className="form-error">{addErrorMessage(add.error)}</p> : null}

        {listing.isPending ? (
          <SkeletonBlock rows={3} />
        ) : listing.isError ? (
          <ErrorState message="Erreur de chargement, réessaie." onRetry={() => listing.refetch()} />
        ) : (
          <table className="plain-table settings-table">
            <thead>
              <tr>
                <th>IP ou plage</th>
                <th>Note</th>
                <th>Ajoutée</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listing.data.items.map((item) => (
                <tr key={item.cidr}>
                  <td className="mono">{item.cidr}</td>
                  <td>{item.note ?? ""}</td>
                  <td className="mono cell-muted">{formatTimestamp(item.created_at)}</td>
                  <td className="cell-actions">
                    <button
                      className="btn btn-sm"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(item.cidr)}
                      aria-label={`Retirer ${item.cidr}`}
                    >
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
              {listing.data.env.map((cidr) => (
                <tr key={`env-${cidr}`} className="pseudo-row">
                  <td className="mono">{cidr}</td>
                  <td>via ADMIN_IPS (.env du serveur)</td>
                  <td />
                  <td />
                </tr>
              ))}
              {listing.data.items.length === 0 && listing.data.env.length === 0 ? (
                <tr>
                  <td colSpan={4} className="cell-muted">
                    Aucune IP protégée pour l'instant.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
