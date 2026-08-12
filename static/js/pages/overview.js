import { fetchJSON, escapeHtml } from "../api.js";
import { renderSkeleton, renderError, renderEmpty } from "../ui.js";
import { renderTimelineChart } from "../charts.js";
import { icons } from "../icons.js";

function proportionRows(items, labelKey) {
  const max = Math.max(...items.map((i) => i.n), 1);
  return items
    .map(
      (i) => `
      <div class="proportion-row">
        <span class="proportion-label">${escapeHtml(String(i[labelKey]))}</span>
        <div class="proportion-bar"><div class="proportion-fill" style="width:${Math.round((i.n / max) * 100)}%"></div></div>
        <span class="proportion-value">${i.n}</span>
      </div>`
    )
    .join("");
}

export async function renderOverview(content, params = {}) {
  content.innerHTML = renderSkeleton(6);
  try {
    const data = await fetchJSON("/api/overview");
    content.innerHTML = `
      <div class="topbar">
        <h1>Overview</h1>
        <button class="btn" data-action="refresh">${icons.refresh}Actualiser</button>
      </div>
      <div class="cards">
        <div class="card"><span>Connexions</span><b>${data.total_connections}</b></div>
        <div class="card"><span>IP uniques</span><b>${data.unique_ips}</b></div>
        <div class="card"><span>Logins tentés</span><b>${data.login_attempts}</b></div>
        <div class="card card-danger"><span>Actuellement banni</span><b>${data.currently_banned}</b></div>
      </div>
      <div class="panel timeline-panel">
        <h3>Timeline</h3>
        <div class="chart-container"><canvas id="timeline-chart"></canvas></div>
      </div>
      <div class="panels">
        <div class="panel">
          <h3>Top pays</h3>
          ${data.top_countries.length ? proportionRows(data.top_countries, "country") : renderEmpty("Aucune donnée")}
        </div>
        <div class="panel">
          <h3>Top IP</h3>
          ${data.top_ips.length ? proportionRows(data.top_ips, "src_ip") : renderEmpty("Aucune donnée")}
        </div>
      </div>
    `;
    if (data.timeline.length) {
      renderTimelineChart(document.getElementById("timeline-chart"), data.timeline);
    }
    content.querySelector('[data-action="refresh"]').addEventListener("click", () => renderOverview(content));
  } catch (err) {
    content.innerHTML = renderError("Erreur de chargement, réessaie.");
    content.querySelector('[data-action="retry"]').addEventListener("click", () => renderOverview(content));
  }
}
