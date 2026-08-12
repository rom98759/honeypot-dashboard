const content = document.getElementById("content");
let currentSessionFilter = null;

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML.replaceAll('"', "&quot;");
}

function renderTimeline(timeline) {
  if (!timeline || timeline.length === 0) {
    return "<p>Aucune donnée</p>";
  }
  const maxN = Math.max(...timeline.map((t) => t.n));
  const bars = timeline
    .map((t) => {
      const height = maxN ? Math.max(4, Math.round((t.n / maxN) * 60)) : 4;
      const label = escapeHtml(String(t.hour).slice(-2));
      return `
        <div class="timeline-bar" title="${escapeHtml(t.hour)} — ${t.n}">
          <div class="timeline-bar-fill" style="height:${height}px"></div>
          <span class="timeline-bar-label">${label}</span>
        </div>`;
    })
    .join("");
  return `<div class="timeline-chart">${bars}</div>`;
}

async function renderOverview() {
  try {
    const data = await fetchJSON("/api/overview");
    content.innerHTML = `
      <div class="cards">
        <div class="card"><span>Connexions</span><b>${data.total_connections}</b></div>
        <div class="card"><span>IP uniques</span><b>${data.unique_ips}</b></div>
        <div class="card"><span>Logins tentés</span><b>${data.login_attempts}</b></div>
        <div class="card"><span>Actuellement banni</span><b>${data.currently_banned}</b></div>
      </div>
      <div class="panel timeline-panel">
        <h3>Timeline</h3>
        ${renderTimeline(data.timeline)}
      </div>
      <div class="panels">
        <div class="panel">
          <h3>Top pays</h3>
          <ul>${data.top_countries.map(c => `<li>${escapeHtml(c.country)} — ${c.n}</li>`).join("") || "<li>Aucune donnée</li>"}</ul>
        </div>
        <div class="panel">
          <h3>Top IP</h3>
          <ul>${data.top_ips.map(ip => `<li>${escapeHtml(ip.src_ip)} — ${ip.n}</li>`).join("") || "<li>Aucune donnée</li>"}</ul>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = "<p>Erreur de chargement, réessaie.</p>";
  }
}

async function renderSessions(filterIp) {
  currentSessionFilter = filterIp || null;
  const query = currentSessionFilter ? `?ip=${encodeURIComponent(currentSessionFilter)}` : "";
  try {
    const sessions = await fetchJSON(`/api/sessions${query}`);
    content.innerHTML = `
      <input id="ip-filter" class="filter-input" placeholder="Filtrer par IP..."
             value="${escapeHtml(currentSessionFilter || "")}">
      <table class="sessions-table">
        <thead><tr><th>IP</th><th>Début</th><th>Durée</th><th>Login</th></tr></thead>
        <tbody>
          ${sessions.map(s => `
            <tr class="session-row" data-id="${escapeHtml(s.session_id)}">
              <td>${escapeHtml(s.src_ip)}</td>
              <td>${escapeHtml(s.connect_time)}</td>
              <td>${s.duration_ms ? Math.round(s.duration_ms / 1000) + "s" : "-"}</td>
              <td>${escapeHtml(s.login_username || "-")}</td>
            </tr>`).join("") || `<tr><td colspan="4">Aucune session</td></tr>`}
        </tbody>
      </table>
      <div id="session-detail"></div>
    `;
    document.getElementById("ip-filter").addEventListener("change", (e) => renderSessions(e.target.value));
    document.querySelectorAll(".session-row").forEach((row) => {
      row.addEventListener("click", () => renderSessionDetail(row.dataset.id));
    });
  } catch (err) {
    content.innerHTML = "<p>Erreur de chargement, réessaie.</p>";
  }
}

async function renderSessionDetail(sessionId) {
  try {
    const data = await fetchJSON(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const detail = document.getElementById("session-detail");
    detail.innerHTML = `
      <div class="detail-panels">
        <div id="replay-container"></div>
        <ul class="commands-list">
          ${data.commands.map(c => `<li><code>${escapeHtml(c.input_text)}</code></li>`).join("") || "<li>Aucune commande</li>"}
        </ul>
      </div>
    `;
    const replayContainer = document.getElementById("replay-container");
    const replayUrl = `/api/sessions/${encodeURIComponent(sessionId)}/replay`;
    let replayAvailable = false;
    try {
      const check = await fetch(replayUrl);
      replayAvailable = check.ok;
    } catch {
      replayAvailable = false;
    }
    if (replayAvailable) {
      AsciinemaPlayer.create(replayUrl, replayContainer);
    } else {
      replayContainer.textContent = "Replay indisponible pour cette session.";
    }
  } catch (err) {
    document.getElementById("session-detail").innerHTML = "<p>Erreur de chargement, réessaie.</p>";
  }
}

async function renderCorrelation() {
  try {
    const rows = await fetchJSON("/api/correlation");
    content.innerHTML = `
      <table class="correlation-table">
        <thead><tr><th>IP</th><th>Sessions honeypot</th><th>Banni fail2ban</th><th>Tentatives port 50022</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.ip)}</td>
              <td>${r.honeypot_sessions}</td>
              <td>${r.fail2ban_banned ? "✅" : "❌"}</td>
              <td>${r.real_ssh_attempts > 0 ? `⚠️ ${r.real_ssh_attempts}` : "❌"}</td>
              <td><a href="#" class="view-sessions" data-ip="${escapeHtml(r.ip)}">→ voir sessions</a></td>
            </tr>`).join("") || `<tr><td colspan="5">Aucune donnée</td></tr>`}
        </tbody>
      </table>
    `;
    document.querySelectorAll(".view-sessions").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        setActivePage("sessions");
        renderSessions(link.dataset.ip);
      });
    });
  } catch (err) {
    content.innerHTML = "<p>Erreur de chargement, réessaie.</p>";
  }
}

const pages = { overview: renderOverview, sessions: () => renderSessions(null), correlation: renderCorrelation };

function setActivePage(page) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActivePage(btn.dataset.page);
    pages[btn.dataset.page]();
  });
});

pages.overview();
setInterval(() => {
  const active = document.querySelector(".nav-item.active").dataset.page;
  if (active === "overview") renderOverview();
}, 10000);
