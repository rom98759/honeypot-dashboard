import { icons } from "./icons.js";
import { startRouter, navigate } from "./router.js";
import { renderOverview } from "./pages/overview.js";
import { renderSessions } from "./pages/sessions.js";
import { renderCorrelation } from "./pages/correlation.js";

const content = document.getElementById("content");
const pages = { overview: renderOverview, sessions: renderSessions, correlation: renderCorrelation };

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
  setActiveNav(page in pages ? page : "overview");
  render(content, params);
});

setInterval(() => {
  const active = document.querySelector(".nav-item.active")?.dataset.page;
  if (active === "overview") renderOverview(content, {});
}, 10000);
