const BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  /** структурированный detail от сервера (например, код конфликта) */
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(BASE + path, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!resp.ok) {
    let message = resp.statusText;
    let detail: unknown;
    try {
      const data = await resp.json();
      detail = data.detail;
      message =
        typeof data.detail === "string"
          ? data.detail
          : ((data.detail as { message?: string })?.message ?? JSON.stringify(data.detail));
    } catch {
      /* not json */
    }
    throw new ApiError(resp.status, message, detail);
  }
  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return resp.json();
  return undefined as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
