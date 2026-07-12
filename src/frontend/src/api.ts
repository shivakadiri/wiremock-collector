export type Instance = {
  id: number;
  name: string;
  base_url: string;
  enabled: boolean;
  source: string;
  docker_container_id: string | null;
  docker_name: string | null;
  last_collected_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type CollectedRequest = {
  id: number;
  instance_id: number;
  wiremock_request_id: string;
  method: string;
  url: string;
  absolute_url: string | null;
  status: number | null;
  was_matched: boolean;
  stub_mapping_id: string | null;
  stub_name?: string | null;
  logged_at: string | null;
  timing_total: number | null;
  payload: Record<string, unknown>;
  collected_at: string;
  request_body_truncated?: boolean;
  response_body_truncated?: boolean;
};

export type RequestList = {
  items: CollectedRequest[];
  total: number;
  limit: number;
  offset: number;
  method_counts: Record<string, number>;
};

export type CollectResult = {
  instance_id: number;
  instance_name: string;
  fetched: number;
  inserted: number;
  error: string | null;
  journal_cleared?: boolean;
};

export type ClearJournalResult = {
  instance_id: number;
  instance_name: string;
  cleared: boolean;
  error: string | null;
};

export type AppSettings = {
  clear_journal_after_collect: boolean;
  collect_interval_seconds: number;
};

export type DiscoveredInstance = {
  name: string;
  base_url: string;
  docker_container_id: string | null;
  docker_name: string | null;
  image: string;
  verified: boolean;
  reason: string;
  action: string;
  instance_id: number | null;
};

export type DiscoverResult = {
  scanned: number;
  added: DiscoveredInstance[];
  updated: DiscoveredInstance[];
  skipped: DiscoveredInstance[];
  errors: string[];
};

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
};

export type QuerySchema = {
  tables: { name: string; columns: string[] }[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  listInstances: () => request<Instance[]>("/api/instances"),
  createInstance: (body: { name: string; base_url: string; enabled?: boolean }) =>
    request<Instance>("/api/instances", { method: "POST", body: JSON.stringify(body) }),
  updateInstance: (id: number, body: Partial<{ name: string; base_url: string; enabled: boolean }>) =>
    request<Instance>(`/api/instances/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteInstance: (id: number) => request<void>(`/api/instances/${id}`, { method: "DELETE" }),
  discoverInstances: () => request<DiscoverResult>("/api/instances/discover", { method: "POST" }),
  collectAll: (clearAfter?: boolean) => {
    const qs = clearAfter === undefined ? "" : `?clear_after=${clearAfter ? "true" : "false"}`;
    return request<CollectResult[]>(`/api/collect${qs}`, { method: "POST" });
  },
  collectOne: (id: number, clearAfter?: boolean) => {
    const qs = clearAfter === undefined ? "" : `?clear_after=${clearAfter ? "true" : "false"}`;
    return request<CollectResult>(`/api/instances/${id}/collect${qs}`, { method: "POST" });
  },
  clearJournals: () => request<ClearJournalResult[]>("/api/clear-journals", { method: "POST" }),
  clearJournal: (id: number) =>
    request<ClearJournalResult>(`/api/instances/${id}/clear-journal`, { method: "POST" }),
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (body: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  listRequests: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    return request<RequestList>(`/api/requests?${qs}`);
  },
  getRequest: (id: number, full = false) =>
    request<CollectedRequest>(`/api/requests/${id}?full=${full ? "true" : "false"}`),
  getRequestBody: (id: number, part: "request" | "response") =>
    request<{ id: number; part: string; section: Record<string, unknown> }>(
      `/api/requests/${id}/body?part=${part}`,
    ),
  getStubs: (instanceId: number) =>
    request<{ mappings: Record<string, unknown>[] }>(`/api/instances/${instanceId}/stubs`),
  getScenarios: (instanceId: number) =>
    request<{ scenarios: Record<string, unknown>[] }>(`/api/instances/${instanceId}/scenarios`),
  getQuerySchema: () => request<QuerySchema>("/api/query/schema"),
  runQuery: (sql: string, limit = 200) =>
    request<QueryResult>("/api/query", { method: "POST", body: JSON.stringify({ sql, limit }) }),
};
