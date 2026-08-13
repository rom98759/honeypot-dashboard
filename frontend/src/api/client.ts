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
