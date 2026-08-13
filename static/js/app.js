import { icons } from "./icons.js";
import { startRouter, navigate } from "./router.js";
import { renderOverview } from "./pages/overview.js";
import { renderSessions, cleanupSessionsPage } from "./pages/sessions.js";
import { renderCorrelation } from "./pages/correlation.js";

const content = document.getElementById("content");
const pages = { overview: renderOverview, sessions: renderSessions, correlation: renderCorrelation };

let renderId = 0;

// Stamps a fresh render id on #content and calls the render function with it,
// so a stale async render (from a page or refresh the user has since
// navigated away from) can detect it's no longer current and bail out
// before overwriting the page the user is actually looking at.
function runRender(renderFn, params, opts) {
  content.dataset.renderId = String(++renderId);
  return renderFn(content, params, opts);
}

document.querySelectorAll("[data-icon]").forEach((el) => {
  el.innerHTML = icons[el.dataset.icon] || "";
});

function setActiveNav(page) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.page));
});

startRouter(({ page, params }) => {
  const render = pages[page] || pages.overview;
  if (page !== "sessions") cleanupSessionsPage();
  setActiveNav(page in pages ? page : "overview");
  runRender(render, params);
});

setInterval(() => {
  const active = document.querySelector(".nav-item.active")?.dataset.page;
  if (active === "overview") runRender(renderOverview, {}, { skeleton: false });
}, 10000);
