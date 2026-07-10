import { useEffect, useMemo, useState } from "react";
import { CollectedRequest } from "../api";
import { DecodedBody, decodeWireMockBodyFull } from "../lib/bodyDecode";
import BodyViewer from "./BodyViewer";

type Props = {
  request: CollectedRequest;
  instanceName?: string;
  onClose: () => void;
};

type MainTab = "bodies" | "raw";

const emptyBody: DecodedBody = { text: "", bytes: null, contentType: "" };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function headersList(headers: unknown): [string, string][] {
  const h = asRecord(headers);
  return Object.entries(h).map(([k, v]) => [
    k,
    Array.isArray(v) ? v.map(String).join(", ") : String(v ?? ""),
  ]);
}

export default function RequestDetailModal({ request, instanceName, onClose }: Props) {
  const [tab, setTab] = useState<MainTab>("bodies");
  const [reqBody, setReqBody] = useState<DecodedBody>(emptyBody);
  const [resBody, setResBody] = useState<DecodedBody>(emptyBody);
  const [bodyError, setBodyError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const payload = request.payload ?? {};
  const req = asRecord(payload.request);
  const res = asRecord(payload.response);
  const reqHeaders = useMemo(() => headersList(req.headers), [req]);
  const resHeaders = useMemo(() => headersList(res.headers), [res]);

  useEffect(() => {
    let cancelled = false;
    setBodyError(null);
    const reqSection = asRecord((request.payload ?? {}).request);
    const resSection = asRecord((request.payload ?? {}).response);
    (async () => {
      try {
        const [rb, sb] = await Promise.all([
          decodeWireMockBodyFull(reqSection),
          decodeWireMockBodyFull(resSection),
        ]);
        if (!cancelled) {
          setReqBody(rb);
          setResBody(sb);
        }
      } catch (err) {
        if (!cancelled) setBodyError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const when = request.logged_at ?? request.collected_at;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="request-detail-title">
              <span className="pill method">{request.method}</span>{" "}
              <span className="mono">{request.url}</span>
            </h2>
            <p className="muted small">
              {instanceName ?? `instance #${request.instance_id}`}
              {" · "}
              status {request.status ?? "—"}
              {" · "}
              {request.was_matched ? "matched" : "unmatched"}
              {" · "}
              {when ? new Date(when).toLocaleString() : "—"}
              {request.timing_total != null ? ` · ${request.timing_total} ms` : ""}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <div className="modal-tabs">
          <button
            type="button"
            className={`ghost compact ${tab === "bodies" ? "active-format" : ""}`}
            onClick={() => setTab("bodies")}
          >
            Request / Response
          </button>
          <button
            type="button"
            className={`ghost compact ${tab === "raw" ? "active-format" : ""}`}
            onClick={() => setTab("raw")}
          >
            Raw JSON
          </button>
        </div>

        <div className="modal-body">
          {bodyError && <div className="banner error">{bodyError}</div>}
          {tab === "bodies" ? (
            <div className="bodies-grid">
              <section className="body-card">
                <h3>Request</h3>
                <dl className="meta compact-meta">
                  <div>
                    <dt>URL</dt>
                    <dd className="mono">{String(req.absoluteUrl ?? req.url ?? request.url)}</dd>
                  </div>
                  <div>
                    <dt>Method</dt>
                    <dd>{String(req.method ?? request.method)}</dd>
                  </div>
                </dl>
                {reqHeaders.length > 0 && (
                  <details className="headers-block">
                    <summary>Headers ({reqHeaders.length})</summary>
                    <table className="headers-table">
                      <tbody>
                        {reqHeaders.map(([k, v]) => (
                          <tr key={k}>
                            <td className="mono">{k}</td>
                            <td className="mono">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                <BodyViewer
                  label="Body"
                  raw={reqBody.text}
                  bytes={reqBody.bytes}
                  contentType={reqBody.contentType}
                  defaultFormat="json"
                />
              </section>

              <section className="body-card">
                <h3>Response</h3>
                <dl className="meta compact-meta">
                  <div>
                    <dt>Status</dt>
                    <dd>{String(res.status ?? request.status ?? "—")}</dd>
                  </div>
                  <div>
                    <dt>Stub</dt>
                    <dd className="mono">{request.stub_mapping_id ?? "—"}</dd>
                  </div>
                </dl>
                {resHeaders.length > 0 && (
                  <details className="headers-block">
                    <summary>Headers ({resHeaders.length})</summary>
                    <table className="headers-table">
                      <tbody>
                        {resHeaders.map(([k, v]) => (
                          <tr key={k}>
                            <td className="mono">{k}</td>
                            <td className="mono">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                <BodyViewer
                  label="Body"
                  raw={resBody.text}
                  bytes={resBody.bytes}
                  contentType={resBody.contentType}
                  defaultFormat="json"
                />
              </section>
            </div>
          ) : (
            <pre className="json-body raw-json">{JSON.stringify(payload, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
