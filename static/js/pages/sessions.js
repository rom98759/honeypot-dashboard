import { fetchJSON, escapeHtml } from "../api.js";
import { renderSkeleton, renderError, renderEmpty } from "../ui.js";
import { icons } from "../icons.js";
import { navigate } from "../router.js";

const PAGE_SIZE = 25;
const COLUMNS = [
  { key: "src_ip", label: "IP" },
  { key: "connect_time", label: "Début" },
  { key: "duration_ms", label: "Durée" },
  { key: "login_username", label: "Login" },
];

let filterDebounce = null;

function formatDuration(ms) {
  return ms ? `${Math.round(ms / 1000)}s` : "-";
}

let activeKeydownHandler = null;

function closeSessionPanel(baseParams) {
  document.getElementById("session-panel")?.remove();
  document.getElementById("session-backdrop")?.remove();
  if (activeKeydownHandler) {
    document.removeEventListener("keydown", activeKeydownHandler);
    activeKeydownHandler = null;
  }
  navigate("sessions", baseParams);
}

async function openSessionPanel(sessionId, baseParams) {
  const backdrop = document.createElement("div");
  backdrop.id = "session-backdrop";
  backdrop.className = "panel-backdrop";
  document.body.appendChild(backdrop);

  const panel = document.createElement("aside");
  panel.id = "session-panel";
  panel.className = "session-panel";
  panel.innerHTML = renderSkeleton(6);
  document.body.appendChild(panel);

  activeKeydownHandler = (e) => {
    if (e.key === "Escape") closeSessionPanel(baseParams);
  };
  document.addEventListener("keydown", activeKeydownHandler);
  backdrop.addEventListener("click", () => closeSessionPanel(baseParams));

  try {
    const data = await fetchJSON(`/api/sessions/${encodeURIComponent(sessionId)}`);
    panel.innerHTML = `
      <div class="panel-header">
        <h2 class="mono">${escapeHtml(data.session.session_id)}</h2>
        <button data-action="close" class="btn-icon">${icons.close}</button>
      </div>
      <div id="replay-container"></div>
      <h3>Commandes</h3>
      <ul class="commands-list">
        ${
          data.commands
            .map((c) => `<li><span class="mono">${escapeHtml(c.timestamp)}</span><code>${escapeHtml(c.input_text)}</code></li>`)
            .join("") || "<li>Aucune commande</li>"
        }
      </ul>
    `;
    panel.querySelector('[data-action="close"]').addEventListener("click", () => closeSessionPanel(baseParams));

    const replayContainer = panel.querySelector("#replay-container");
    const replayUrl = `/api/sessions/${encodeURIComponent(sessionId)}/replay`;
    const check = await fetch(replayUrl);
    if (check.ok) {
      AsciinemaPlayer.create(replayUrl, replayContainer);
    } else {
      replayContainer.textContent = "Replay indisponible pour cette session.";
    }
  } catch (err) {
    panel.innerHTML = renderError("Erreur de chargement de la session.");
    panel.querySelector('[data-action="retry"]').addEventListener("click", () => openSessionPanel(sessionId, baseParams));
  }
}

export async function renderSessions(content, params = {}) {
  const ip = params.ip || "";
  const sort = params.sort || "connect_time";
  const order = params.order === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  content.innerHTML = renderSkeleton(8);
  try {
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort,
      order,
    });
    if (ip) query.set("ip", ip);
    const data = await fetchJSON(`/api/sessions?${query.toString()}`);
    const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

    content.innerHTML = `
      <div class="topbar">
        <h1>Sessions</h1>
        <span class="result-count">${data.total} résultat${data.total > 1 ? "s" : ""}</span>
      </div>
      <div class="filter-bar">
        ${icons.search}
        <input id="ip-filter" class="filter-input" placeholder="Filtrer par IP..." value="${escapeHtml(ip)}">
      </div>
      <table class="sessions-table">
        <thead><tr>
          ${COLUMNS.map(
            (col) => `
            <th>
              <button class="sort-header" data-sort="${col.key}">
                ${col.label}
                ${sort === col.key ? (order === "asc" ? icons.sortUp : icons.sortDown) : ""}
              </button>
            </th>`
          ).join("")}
        </tr></thead>
        <tbody>
          ${
            data.items
              .map(
                (s) => `
            <tr class="session-row" data-id="${escapeHtml(s.session_id)}">
              <td class="mono">${escapeHtml(s.src_ip)}</td>
              <td class="mono">${escapeHtml(s.connect_time)}</td>
              <td>${formatDuration(s.duration_ms)}</td>
              <td>${escapeHtml(s.login_username || "-")}</td>
            </tr>`
              )
              .join("") || `<tr><td colspan="4">${renderEmpty("Aucune session")}</td></tr>`
          }
        </tbody>
      </table>
      <div class="pagination">
        <button class="btn" data-action="prev" ${page <= 1 ? "disabled" : ""}>Précédent</button>
        <span>Page ${page} / ${totalPages}</span>
        <button class="btn" data-action="next" ${page >= totalPages ? "disabled" : ""}>Suivant</button>
      </div>
    `;

    content.querySelector("#ip-filter").addEventListener("input", (e) => {
      clearTimeout(filterDebounce);
      const value = e.target.value;
      filterDebounce = setTimeout(() => {
        navigate("sessions", value ? { ip: value } : {});
      }, 300);
    });

    content.querySelectorAll(".sort-header").forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = btn.dataset.sort;
        const nextOrder = sort === col && order === "asc" ? "desc" : "asc";
        navigate("sessions", { ...(ip ? { ip } : {}), sort: col, order: nextOrder });
      });
    });

    content.querySelectorAll(".session-row").forEach((row) => {
      row.addEventListener("click", () => {
        navigate("sessions", { ...(ip ? { ip } : {}), sort, order, page: String(page), session: row.dataset.id });
      });
    });

    content.querySelector('[data-action="prev"]')?.addEventListener("click", () => {
      navigate("sessions", { ...(ip ? { ip } : {}), sort, order, page: String(page - 1) });
    });
    content.querySelector('[data-action="next"]')?.addEventListener("click", () => {
      navigate("sessions", { ...(ip ? { ip } : {}), sort, order, page: String(page + 1) });
    });

    if (params.session) {
      openSessionPanel(params.session, { ip, sort, order, page: String(page) });
    }
  } catch (err) {
    content.innerHTML = renderError("Erreur de chargement, réessaie.");
    content.querySelector('[data-action="retry"]').addEventListener("click", () => renderSessions(content, params));
  }
}
