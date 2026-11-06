export class ApiError extends Error {
  status: number;
  /** FastAPI's `detail` when it is a plain message (e.g. a search syntax error). */
  detail: string | null;

  constructor(url: string, status: number, detail: string | null = null) {
    super(`${url} -> ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function errorFor(url: string, response: Response): Promise<ApiError> {
  let detail: string | null = null;
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    // Not JSON: the status alone says enough.
  }
  return new ApiError(url, response.status, detail);
}

/** The message of a rejected search filter, to show next to the search bar. */
export function filterErrorOf(error: unknown): string | null {
  return error instanceof ApiError && error.status === 400 ? error.detail ?? "requête invalide" : null;
}

export async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw await errorFor(url, response);
  }
  return response.json() as Promise<T>;
}

export async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { method: "POST" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!response.ok) {
    throw await errorFor(url, response);
  }
  return response.json() as Promise<T>;
}
