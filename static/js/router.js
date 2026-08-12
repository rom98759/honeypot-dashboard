export function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, queryString] = hash.split("?");
  const params = Object.fromEntries(new URLSearchParams(queryString || ""));
  return { page: path || "overview", params };
}

export function navigate(page, params = {}) {
  const query = new URLSearchParams(params).toString();
  location.hash = `/${page}${query ? `?${query}` : ""}`;
}

export function startRouter(callback) {
  window.addEventListener("hashchange", () => callback(parseRoute()));
  callback(parseRoute());
}
