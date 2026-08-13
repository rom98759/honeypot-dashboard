import { icons } from "./icons.js";

export function renderSkeleton(rows = 4) {
  const lines = Array.from({ length: rows }, () => `<div class="skeleton-line"></div>`).join("");
  return `<div class="skeleton-block">${lines}</div>`;
}

export function renderError(message) {
  return `<div class="state-error"><p>${message}</p><button data-action="retry" class="btn">Réessayer</button></div>`;
}

export function renderEmpty(message) {
  return `<div class="state-empty">${icons.search}<p>${message}</p></div>`;
}

export function badge(label, tone) {
  return `<span class="badge badge-${tone}">${label}</span>`;
}

export function renderSortHeaders(columns, sort, order) {
  return columns
    .map(
      (col) => `
      <th>
        <button class="sort-header" data-sort="${col.key}">
          ${col.label}
          ${sort === col.key ? (order === "asc" ? icons.sortUp : icons.sortDown) : ""}
        </button>
      </th>`
    )
    .join("");
}

export function bindSortHeaders(container, onSort) {
  container.querySelectorAll(".sort-header").forEach((btn) => {
    btn.addEventListener("click", () => onSort(btn.dataset.sort));
  });
}

export function bindRetry(container, onRetry) {
  container.querySelector('[data-action="retry"]').addEventListener("click", onRetry);
}
