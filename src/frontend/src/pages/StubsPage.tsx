import { useEffect, useState } from "react";
import { api, Instance } from "../api";

export default function StubsPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<string>("");
  const [mappings, setMappings] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .listInstances()
      .then((list) => {
        setInstances(list);
        if (list.length && !instanceId) setInstanceId(String(list[0].id));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!instanceId) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    api
      .getStubs(Number(instanceId))
      .then((data) => setMappings(data.mappings))
      .catch((e: Error) => {
        setMappings([]);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [instanceId]);

  return (
    <section>
      <div className="page-header row">
        <div>
          <h1>Stubs</h1>
          <p className="muted">Live stub mappings from WireMock admin API.</p>
        </div>
        <label>
          Instance
          <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">Loading stubs…</p>}

      <div className="split">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Method</th>
                <th>URL pattern</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, idx) => {
                const request = (m.request as Record<string, unknown> | undefined) ?? {};
                const meta = (m.metadata as Record<string, unknown> | undefined) ?? {};
                const method = String(request.method ?? "*");
                const url =
                  String(
                    request.urlPath ??
                      request.urlPathPattern ??
                      request.urlPattern ??
                      request.url ??
                      "",
                  ) || "—";
                const name = String(m.name ?? meta.name ?? m.id ?? idx);
                return (
                  <tr
                    key={String(m.id ?? idx)}
                    className={selected === m ? "selected" : undefined}
                    onClick={() => setSelected(m)}
                  >
                    <td>{String(m.priority ?? "—")}</td>
                    <td>
                      <span className="pill method">{method}</span>
                    </td>
                    <td className="mono truncate">{url}</td>
                    <td>{name}</td>
                  </tr>
                );
              })}
              {!loading && mappings.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No stub mappings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <aside className="panel detail">
          <h2>Stub JSON</h2>
          {!selected && <p className="muted">Select a stub.</p>}
          {selected && <pre>{JSON.stringify(selected, null, 2)}</pre>}
        </aside>
      </div>
    </section>
  );
}
