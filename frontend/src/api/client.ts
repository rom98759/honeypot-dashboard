export class ApiError extends Error {
  status: number;

  constructor(url: string, status: number) {
    super(`${url} -> ${status}`);
    this.status = status;
  }
}

export async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(url, response.status);
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
    throw new ApiError(url, response.status);
  }
  return response.json() as Promise<T>;
}
