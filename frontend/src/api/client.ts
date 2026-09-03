const BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  /** structured `detail` from the server (e.g. a conflict code) */
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

// ---------- workspace ----------

let currentSlug = "";

export function setWorkspaceSlug(slug: string) {
  currentSlug = slug;
}

export function getWorkspaceSlug(): string {
  return currentSlug;
}

/** Absolute URL inside the current workspace — for <a href> (export). */
export function workspaceUrl(path: string): string {
  return `${BASE}/w/${currentSlug}${path}`;
}

/** Domain API client for the current workspace: /api/v1/w/{slug}/... */
export const wapi = {
  get: <T>(path: string) => api.get<T>(`/w/${currentSlug}${path}`),
  post: <T>(path: string, body?: unknown) => api.post<T>(`/w/${currentSlug}${path}`, body),
  patch: <T>(path: string, body: unknown) => api.patch<T>(`/w/${currentSlug}${path}`, body),
  put: <T>(path: string, body: unknown) => api.put<T>(`/w/${currentSlug}${path}`, body),
  delete: <T>(path: string) => api.delete<T>(`/w/${currentSlug}${path}`),
};
