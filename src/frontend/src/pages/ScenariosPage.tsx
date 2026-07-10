import { useEffect, useState } from "react";
import { api, Instance } from "../api";

type Scenario = {
  id?: string;
  name?: string;
  state?: string;
  possibleStates?: string[];
  [key: string]: unknown;
};

export default function ScenariosPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<string>("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Scenario | null>(null);
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
      .getScenarios(Number(instanceId))
      .then((data) => setScenarios(data.scenarios as Scenario[]))
      .catch((e: Error) => {
        setScenarios([]);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [instanceId]);

  return (
    <section>
      <div className="page-header row">
        <div>
          <h1>Scenarios</h1>
          <p className="muted">Live scenario state from WireMock admin API.</p>
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
      {loading && <p className="muted">Loading scenarios…</p>}

      <div className="split">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Possible states</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, idx) => (
                <tr
                  key={String(s.id ?? s.name ?? idx)}
                  className={selected === s ? "selected" : undefined}
                  onClick={() => setSelected(s)}
                >
                  <td>
                    <strong>{s.name ?? s.id ?? "—"}</strong>
                  </td>
                  <td>
                    <span className="pill ok">{s.state ?? "—"}</span>
                  </td>
                  <td className="muted">{(s.possibleStates ?? []).join(", ") || "—"}</td>
                </tr>
              ))}
              {!loading && scenarios.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No scenarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <aside className="panel detail">
          <h2>Scenario JSON</h2>
          {!selected && <p className="muted">Select a scenario.</p>}
          {selected && <pre>{JSON.stringify(selected, null, 2)}</pre>}
        </aside>
      </div>
    </section>
  );
}
