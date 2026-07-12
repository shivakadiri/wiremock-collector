import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, CollectedRequest, Instance } from "../api";
import RequestDetailModal from "../components/RequestDetailModal";

function formatRequestTime(r: CollectedRequest): string {
  const value = r.logged_at ?? r.collected_at;
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function RequestsPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [items, setItems] = useState<CollectedRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [methodCounts, setMethodCounts] = useState<Record<string, number>>({});
  const [instanceId, setInstanceId] = useState<string>("");
  const [method, setMethod] = useState("");
  const [matched, setMatched] = useState<string>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CollectedRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const instanceMap = useMemo(() => new Map(instances.map((i) => [i.id, i.name])), [instances]);

  async function load() {
    const [inst, reqs] = await Promise.all([
      api.listInstances(),
      api.listRequests({
        instance_id: instanceId || undefined,
        method: method || undefined,
        matched: matched === "" ? undefined : matched === "true",
        q: q || undefined,
        limit: 50,
      }),
    ]);
    setInstances(inst);
    setItems(reqs.items);
    setTotal(reqs.total);
    setMethodCounts(reqs.method_counts ?? {});
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [instanceId, method, matched]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    try {
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function collectNow() {
    setBusy(true);
    setError(null);
    try {
      await api.collectAll();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="requests-page">
      <div className="page-header row compact-header">
        <div>
          <h1>Requests</h1>
          <p className="muted">
            {total} stored · click a row for detail
          </p>
          {Object.keys(methodCounts).length > 0 && (
            <div className="method-counts">
              {Object.entries(methodCounts).map(([m, n]) => (
                <button
                  key={m}
                  type="button"
                  className={`pill method ${method === m ? "selected-pill" : ""}`}
                  onClick={() => setMethod(method === m ? "" : m)}
                  title={`Filter ${m}`}
                >
                  {m} {n}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={collectNow} disabled={busy}>
          {busy ? "Collecting…" : "Collect now"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <form className="panel form-row compact-filters" onSubmit={onSearch}>
        <label>
          Instance
          <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
            <option value="">All</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All</option>
            {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Matched
          <select value={matched} onChange={(e) => setMatched(e.target.value)}>
            <option value="">All</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label className="grow">
          URL contains
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="/api/..." />
        </label>
        <button type="submit">Filter</button>
      </form>

      <div className="table-wrap full-table">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Instance</th>
              <th>Method</th>
              <th>URL</th>
              <th>Status</th>
              <th>Stub</th>
              <th>Matched</th>
              <th>Timing</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)}>
                <td
                  className="muted nowrap"
                  title={r.logged_at ? "WireMock logged time" : "Collected time"}
                >
                  {formatRequestTime(r)}
                </td>
                <td className="nowrap">{instanceMap.get(r.instance_id) ?? r.instance_id}</td>
                <td>
                  <span className="pill method">{r.method}</span>
                </td>
                <td className="mono url-cell">{r.url}</td>
                <td>{r.status ?? "—"}</td>
                <td className="mono stub-cell" title={r.stub_mapping_id ?? undefined}>
                  {r.stub_name ?? r.stub_mapping_id ?? "—"}
                </td>
                <td>
                  <span className={`pill ${r.was_matched ? "ok" : "bad"}`}>
                    {r.was_matched ? "yes" : "no"}
                  </span>
                </td>
                <td className="muted nowrap">
                  {r.timing_total != null ? `${r.timing_total} ms` : "—"}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No requests yet. Add an instance and collect.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <RequestDetailModal
          request={selected}
          instanceName={instanceMap.get(selected.instance_id)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
