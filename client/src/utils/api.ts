const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

type ApiOptions = RequestInit & { json?: unknown };

export const apiFetch = async <T>(path: string, options: ApiOptions = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.json ? JSON.stringify(options.json) : options.body,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Erreur API (${response.status})`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};
