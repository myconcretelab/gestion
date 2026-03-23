const API_BASE = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE ?? "/api");

type ApiOptions = RequestInit & { json?: unknown };
type ApiValidationDetails = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
};

type ApiErrorPayload = {
  error?: string;
  details?: ApiValidationDetails;
};

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error ?? `Erreur API (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
export const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
export const buildApiUrl = (path: string) => new URL(`${API_BASE}${path}`, window.location.origin).toString();

export const apiFetch = async <T>(path: string, options: ApiOptions = {}): Promise<T> => {
  const hasJsonBody = options.json !== undefined;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    body: hasJsonBody ? JSON.stringify(options.json) : options.body,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(response.status, payload);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};
