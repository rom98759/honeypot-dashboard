import { fetchJSON, escapeHtml } from "../api.js";
import { renderSkeleton, renderError, renderEmpty, badge, renderSortHeaders, bindSortHeaders, bindRetry } from "../ui.js";
import { icons } from "../icons.js";
import { navigate } from "../router.js";

const COLUMNS = [
  { key: "ip", label: "IP" },
  { key: "honeypot_sessions", label: "Sessions honeypot" },
  { key: "fail2ban_banned", label: "Banni fail2ban" },
  { key: "real_ssh_attempts", label: "Tentatives port 50022" },
];

function sortRows(rows, sort, order) {
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    if (av === bv) return 0;
    return av > bv ? 1 : -1;
  });
  return order === "desc" ? sorted.reverse() : sorted;
}

export async function renderCorrelation(content, params = {}) {
  const renderId = content.dataset.renderId;
  const sort = params.sort || "honeypot_sessions";
  const order = params.order === "asc" ? "asc" : "desc";

  content.innerHTML = renderSkeleton(6);
  try {
    const rows = sortRows(await fetchJSON("/api/correlation"), sort, order);
    if (content.dataset.renderId !== renderId) return;
    content.innerHTML = `
      <div class="topbar"><h1>Corrélation</h1></div>
      <table class="correlation-table">
        <thead><tr>
          ${renderSortHeaders(COLUMNS, sort, order)}
          <th></th>
        </tr></thead>
        <tbody>
          ${
            rows
              .map(
                (r) => `
            <tr>
              <td class="mono">${escapeHtml(r.ip)}</td>
              <td>${r.honeypot_sessions}</td>
              <td>${r.fail2ban_banned ? badge("Banni", "danger") : badge("Non banni", "neutral")}</td>
              <td>${r.real_ssh_attempts > 0 ? badge(`${r.real_ssh_attempts} tentatives`, "warning") : badge("Aucune", "neutral")}</td>
              <td><button class="btn-icon view-sessions" data-ip="${escapeHtml(r.ip)}" title="Voir les sessions">${icons.externalLink}</button></td>
            </tr>`
              )
              .join("") || `<tr><td colspan="5">${renderEmpty("Aucune donnée")}</td></tr>`
          }
        </tbody>
      </table>
    `;

    bindSortHeaders(content, (col) => {
      const nextOrder = sort === col && order === "asc" ? "desc" : "asc";
      navigate("correlation", { sort: col, order: nextOrder });
    });

    content.querySelectorAll(".view-sessions").forEach((btn) => {
      btn.addEventListener("click", () => navigate("sessions", { ip: btn.dataset.ip }));
    });
  } catch (err) {
    if (content.dataset.renderId !== renderId) return;
    content.innerHTML = renderError("Erreur de chargement, réessaie.");
    bindRetry(content, () => renderCorrelation(content, params));
  }
}
