import { FormEvent, useEffect, useState } from "react";
import { api, DiscoverResult, Instance } from "../api";

export default function InstancesPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://host.docker.internal:8080");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setInstances(await api.listInstances());
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.createInstance({ name, base_url: baseUrl, enabled: true });
      setName("");
      await load();
      setInfo(`Added instance “${name}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function searchDocker() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.discoverInstances();
      setDiscoverResult(result);
      await load();
      if (result.errors.length) {
        setError(result.errors.join("; "));
      } else {
        setInfo(
          `Docker scan complete: ${result.scanned} candidate(s), ${result.added.length} added, ${result.updated.length} updated, ${result.skipped.length} skipped.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(instance: Instance) {
    await api.updateInstance(instance.id, { enabled: !instance.enabled });
    await load();
  }

  async function collect(id: number) {
    setBusy(true);
    try {
      await api.collectOne(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this instance and its collected requests?")) return;
    await api.deleteInstance(id);
    await load();
  }

  return (
    <section>
      <div className="page-header row">
        <div>
          <h1>Instances</h1>
          <p className="muted">Poll multiple WireMock admin bases. Discover from Docker or add manually.</p>
        </div>
        <button type="button" onClick={searchDocker} disabled={busy}>
          {busy ? "Searching…" : "Search Docker"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {info && <div className="banner ok">{info}</div>}

      <form className="panel form-row" onSubmit={onCreate}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="local" />
        </label>
        <label className="grow">
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
            placeholder="http://localhost:8080"
          />
        </label>
        <button type="submit" disabled={busy}>
          Add manually
        </button>
      </form>

      {discoverResult && (
        <div className="panel">
          <h2 className="panel-title">Last Docker scan</h2>
          <p className="muted small">
            Scanned {discoverResult.scanned} container candidate(s). Verified WireMock admin APIs are added
            automatically; unverified matches are skipped.
          </p>
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Name</th>
                  <th>URL</th>
                  <th>Image</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...discoverResult.added, ...discoverResult.updated, ...discoverResult.skipped].map((row, idx) => (
                  <tr key={`${row.docker_container_id}-${idx}`}>
                    <td>
                      <span className={`pill ${row.action === "added" ? "ok" : row.action === "updated" ? "method" : "muted-pill"}`}>
                        {row.action}
                      </span>
                    </td>
                    <td>{row.name}</td>
                    <td className="mono">{row.base_url || "—"}</td>
                    <td className="mono truncate">{row.image}</td>
                    <td className="muted">{row.reason}</td>
                  </tr>
                ))}
                {discoverResult.scanned === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No WireMock-like containers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>URL</th>
              <th>Status</th>
              <th>Last collect</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {instances.map((i) => (
              <tr key={i.id}>
                <td>
                  <strong>{i.name}</strong>
                  {!i.enabled && <span className="pill muted-pill">disabled</span>}
                  {i.docker_name && <div className="muted small mono">{i.docker_name}</div>}
                </td>
                <td>
                  <span className={`pill ${i.source === "docker" ? "method" : "muted-pill"}`}>{i.source}</span>
                </td>
                <td className="mono">{i.base_url}</td>
                <td>
                  {i.last_error ? (
                    <span className="pill bad" title={i.last_error}>
                      error
                    </span>
                  ) : (
                    <span className="pill ok">ok</span>
                  )}
                </td>
                <td className="muted">{i.last_collected_at ? new Date(i.last_collected_at).toLocaleString() : "—"}</td>
                <td className="actions">
                  <button type="button" className="ghost" onClick={() => collect(i.id)} disabled={busy}>
                    Collect
                  </button>
                  <button type="button" className="ghost" onClick={() => toggle(i)}>
                    {i.enabled ? "Disable" : "Enable"}
                  </button>
                  <button type="button" className="ghost danger" onClick={() => remove(i.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {instances.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No instances yet. Search Docker or add one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
