export async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`${url} -> ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML.replaceAll('"', "&quot;");
}
