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
  logged_at: string | null;
  timing_total: number | null;
  payload: Record<string, unknown>;
  collected_at: string;
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
  collectAll: () => request<CollectResult[]>("/api/collect", { method: "POST" }),
  collectOne: (id: number) => request<CollectResult>(`/api/instances/${id}/collect`, { method: "POST" }),
  listRequests: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    return request<RequestList>(`/api/requests?${qs}`);
  },
  getStubs: (instanceId: number) =>
    request<{ mappings: Record<string, unknown>[] }>(`/api/instances/${instanceId}/stubs`),
  getScenarios: (instanceId: number) =>
    request<{ scenarios: Record<string, unknown>[] }>(`/api/instances/${instanceId}/scenarios`),
  getQuerySchema: () => request<QuerySchema>("/api/query/schema"),
  runQuery: (sql: string, limit = 200) =>
    request<QueryResult>("/api/query", { method: "POST", body: JSON.stringify({ sql, limit }) }),
};
