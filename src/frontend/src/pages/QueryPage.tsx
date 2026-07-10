import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { api, QueryResult, QuerySchema } from "../api";

const EXAMPLES: { label: string; sql: string }[] = [
  {
    label: "Recent requests",
    sql: `SELECT r.id, i.name AS instance, r.method, r.url, r.status, r.was_matched,
       COALESCE(r.logged_at, r.collected_at) AS request_time
FROM requests r
JOIN instances i ON i.id = r.instance_id
ORDER BY COALESCE(r.logged_at, r.collected_at) DESC
LIMIT 50`,
  },
  {
    label: "Unmatched by instance",
    sql: `SELECT i.name, COUNT(*) AS unmatched
FROM requests r
JOIN instances i ON i.id = r.instance_id
WHERE r.was_matched = false
GROUP BY i.name
ORDER BY unmatched DESC`,
  },
  {
    label: "Top paths",
    sql: `SELECT method, url, COUNT(*) AS hits
FROM requests
GROUP BY method, url
ORDER BY hits DESC
LIMIT 25`,
  },
  {
    label: "Instances",
    sql: `SELECT id, name, base_url, source, enabled, last_collected_at, last_error
FROM instances
ORDER BY name`,
  },
];

export default function QueryPage() {
  const [sql, setSql] = useState(EXAMPLES[0].sql);
  const [schema, setSchema] = useState<QuerySchema | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getQuerySchema().then(setSchema).catch(() => undefined);
  }, []);

  async function run(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.runQuery(sql, 200));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
    }
  }

  return (
    <section>
      <div className="page-header row">
        <div>
          <h1>Query</h1>
          <p className="muted">Read-only SQL against the collector database (SELECT / WITH / EXPLAIN).</p>
        </div>
        <button type="button" onClick={() => run()} disabled={busy}>
          {busy ? "Running…" : "Run query"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="query-layout">
        <form className="panel query-editor" onSubmit={run}>
          <div className="example-row">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                className="ghost"
                onClick={() => setSql(ex.sql)}
                disabled={busy}
              >
                {ex.label}
              </button>
            ))}
          </div>
          <textarea
            className="sql-input"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            rows={14}
            aria-label="SQL query"
          />
          <div className="muted small">⌘/Ctrl + Enter to run. Results are capped (default 200 rows).</div>
        </form>

        <aside className="panel schema-panel">
          <h2 className="panel-title">Schema</h2>
          {!schema && <p className="muted">Loading…</p>}
          {schema?.tables.map((t) => (
            <div key={t.name} className="schema-table">
              <strong className="mono">{t.name}</strong>
              <ul>
                {t.columns.map((c) => (
                  <li key={c} className="mono">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>

      {result && (
        <div className="panel">
          <div className="page-header row">
            <h2 className="panel-title">
              Results · {result.row_count} row{result.row_count === 1 ? "" : "s"}
              {result.truncated ? " (truncated)" : ""}
            </h2>
          </div>
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, idx) => (
                  <tr key={idx}>
                    {row.map((cell, cidx) => (
                      <td key={cidx} className="mono">
                        {formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(result.columns.length, 1)} className="muted">
                      No rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
