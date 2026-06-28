import {
  API_BASE,
  getGatewayBaseUrl,
  isLocalServiceUrl,
  shouldSkipBuildTimeFetch,
} from "@/lib/env";

const DEFAULT_TIMEOUT_MS = 20_000;
const REQUEST_ID_HEADER = "X-HackMarket-Request-Id";
export { API_BASE, getGatewayBaseUrl, isLocalServiceUrl, shouldSkipBuildTimeFetch };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly requestId: string | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  token?: string | null;
  cache?: RequestCache;
  next?: { revalidate?: number | false; tags?: string[] };
  timeoutMs?: number;
  requestId?: string;
}

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    request_id?: string | null;
  };
};

async function parseResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }

  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function toApiError(res: Response, data: unknown): ApiError {
  const err = (data as ErrorPayload | null)?.error;
  const rawText =
    data && typeof data === "object" && "raw" in (data as Record<string, unknown>)
      ? String((data as Record<string, unknown>).raw)
      : null;

  return new ApiError(
    res.status,
    err?.code ?? (res.status >= 500 ? "UPSTREAM_ERROR" : "UNKNOWN_ERROR"),
    err?.message ?? rawText ?? "Request failed",
    err?.details ?? {},
    err?.request_id ?? res.headers.get(REQUEST_ID_HEADER)
  );
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web_${crypto.randomUUID().replaceAll("-", "")}`;
  }

  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (shouldSkipBuildTimeFetch(input)) {
    throw new ApiError(0, "LOCAL_SERVICE_UNAVAILABLE", "Skipping local service fetch during production build.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "REQUEST_TIMEOUT", "The request took too long to complete.");
    }
    throw new ApiError(0, "NETWORK_ERROR", "We could not reach the server. Please try again.");
  } finally {
    clearTimeout(timeout);
  }
}

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

async function requestWithRetry<T>(
  method: string,
  path: string,
  init: RequestInit,
  options: RequestOptions = {},
  attempt = 0,
): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    init,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  if (res.status === 204) return undefined as T;

  const data = await parseResponseBody(res);
  if (!res.ok) {
    if (
      attempt < MAX_RETRIES &&
      RETRYABLE_STATUS_CODES.has(res.status) &&
      (method === "GET" || method === "HEAD")
    ) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      return requestWithRetry<T>(method, path, init, options, attempt + 1);
    }
    throw toApiError(res, data);
  }

  return data as T;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    [REQUEST_ID_HEADER]: options.requestId ?? createRequestId(),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  return requestWithRetry<T>(
    method,
    path,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: options.cache,
      next: options.next,
    },
    options,
  );
}

async function requestFormData<T>(
  method: string,
  path: string,
  body: FormData,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    [REQUEST_ID_HEADER]: options.requestId ?? createRequestId(),
  };

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  return requestWithRetry<T>(
    method,
    path,
    {
      method,
      headers,
      body,
      cache: options.cache,
      next: options.next,
    },
    options,
  );
}

export const api = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("GET", path, undefined, options);
  },
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, body, options);
  },
  postFormData<T>(path: string, body: FormData, options?: RequestOptions): Promise<T> {
    return requestFormData<T>("POST", path, body, options);
  },
  put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PUT", path, body, options);
  },
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PATCH", path, body, options);
  },
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("DELETE", path, undefined, options);
  },
};

export function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      qs.set(key, String(val));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}
