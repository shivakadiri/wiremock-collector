import { useEffect, useMemo, useState } from "react";
import { api, CollectedRequest } from "../api";
import { DecodedBody, decodeWireMockBodyFull } from "../lib/bodyDecode";
import BodyViewer from "./BodyViewer";
import PropertyValueModal from "./PropertyValueModal";

type Props = {
  request: CollectedRequest;
  instanceName?: string;
  onClose: () => void;
};

type MainTab = "bodies" | "raw";
type BodyPart = "request" | "response";

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

function sectionTruncated(section: Record<string, unknown>, flag?: boolean): boolean {
  return Boolean(flag || section._bodyTruncated);
}

function sectionSize(section: Record<string, unknown>): number | undefined {
  const n = section._bodySize;
  return typeof n === "number" ? n : undefined;
}

function stubLabel(request: CollectedRequest): string {
  if (request.stub_name) return request.stub_name;
  const stub = asRecord((request.payload ?? {}).stubMapping);
  const meta = asRecord(stub.metadata);
  const name = stub.name ?? meta.name ?? request.stub_mapping_id;
  return name != null ? String(name) : "—";
}

export default function RequestDetailModal({ request: initial, instanceName, onClose }: Props) {
  const [request, setRequest] = useState(initial);
  const [metaLoading, setMetaLoading] = useState(true);
  const [tab, setTab] = useState<MainTab>("bodies");
  const [reqBody, setReqBody] = useState<DecodedBody>(emptyBody);
  const [resBody, setResBody] = useState<DecodedBody>(emptyBody);
  const [reqLoaded, setReqLoaded] = useState(false);
  const [resLoaded, setResLoaded] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [fetchingPart, setFetchingPart] = useState<BodyPart | null>(null);
  const [fetchedModal, setFetchedModal] = useState<{ title: string; value: unknown } | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [rawFetching, setRawFetching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRequest(initial);
    setReqBody(emptyBody);
    setResBody(emptyBody);
    setReqLoaded(false);
    setResLoaded(false);
    setFetchedModal(null);
    setRawText(null);
    setBodyError(null);
    setMetaLoading(true);
    setTab("bodies");

    (async () => {
      try {
        // Headers/meta only — never pull bodies on open
        const meta = await api.getRequest(initial.id, false);
        if (!cancelled) {
          setRequest(meta);
          setMetaLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setBodyError(err instanceof Error ? err.message : String(err));
          setMetaLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initial.id]);

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
  const reqTrunc = !reqLoaded && sectionTruncated(req, request.request_body_truncated);
  const resTrunc = !resLoaded && sectionTruncated(res, request.response_body_truncated);
  // Empty bodies: no truncated chip if size is 0
  const reqNeedsFetch = !reqLoaded && (request.request_body_truncated || Boolean(req._bodyTruncated));
  const resNeedsFetch = !resLoaded && (request.response_body_truncated || Boolean(res._bodyTruncated));
  const stub = stubLabel(request);

  async function fetchFullBody(part: BodyPart) {
    setFetchingPart(part);
    setBodyError(null);
    try {
      const { section } = await api.getRequestBody(request.id, part);
      const decoded = await decodeWireMockBodyFull(section);
      if (part === "request") {
        setReqBody(decoded);
        setReqLoaded(true);
      } else {
        setResBody(decoded);
        setResLoaded(true);
      }
      setFetchedModal({
        title: `${part} body`,
        value: decoded.text || (decoded.bytes ? new TextDecoder().decode(decoded.bytes) : ""),
      });
    } catch (err) {
      setBodyError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingPart(null);
    }
  }

  async function ensureRawPayload() {
    if (rawText != null) return;
    setRawFetching(true);
    setBodyError(null);
    try {
      const full = await api.getRequest(request.id, true);
      setRawText(JSON.stringify(full.payload ?? {}, null, 2));
    } catch (err) {
      setBodyError(err instanceof Error ? err.message : String(err));
    } finally {
      setRawFetching(false);
    }
  }

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
              stub {stub}
              {request.stub_mapping_id && stub !== request.stub_mapping_id
                ? ` (${request.stub_mapping_id})`
                : ""}
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
            onClick={() => {
              setTab("raw");
              void ensureRawPayload();
            }}
          >
            Raw JSON
          </button>
        </div>

        <div className="modal-body">
          {bodyError && <div className="banner error">{bodyError}</div>}
          {metaLoading ? (
            <p className="muted">Loading request…</p>
          ) : tab === "bodies" ? (
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
                  truncated={reqNeedsFetch || reqTrunc}
                  truncatedSize={sectionSize(req)}
                  fetching={fetchingPart === "request"}
                  onFetchClick={() => void fetchFullBody("request")}
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
                    <dd className="mono" title={request.stub_mapping_id ?? undefined}>
                      {stub}
                      {request.stub_mapping_id && stub !== request.stub_mapping_id ? (
                        <span className="muted small"> · {request.stub_mapping_id}</span>
                      ) : null}
                    </dd>
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
                  truncated={resNeedsFetch || resTrunc}
                  truncatedSize={sectionSize(res)}
                  fetching={fetchingPart === "response"}
                  onFetchClick={() => void fetchFullBody("response")}
                />
              </section>
            </div>
          ) : rawFetching ? (
            <p className="muted">Loading full payload…</p>
          ) : (
            <pre className="json-body raw-json">{rawText ?? ""}</pre>
          )}
        </div>
      </div>

      {fetchedModal && (
        <PropertyValueModal
          title={fetchedModal.title}
          value={fetchedModal.value}
          onClose={() => setFetchedModal(null)}
        />
      )}
    </div>
  );
}
