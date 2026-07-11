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
  const [tab, setTab] = useState<MainTab>("bodies");
  const [reqBody, setReqBody] = useState<DecodedBody>(emptyBody);
  const [resBody, setResBody] = useState<DecodedBody>(emptyBody);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [fetchingPart, setFetchingPart] = useState<BodyPart | null>(null);
  const [fetchedModal, setFetchedModal] = useState<{ title: string; value: unknown } | null>(null);
  const [rawLoaded, setRawLoaded] = useState(false);
  const [rawFetching, setRawFetching] = useState(false);

  useEffect(() => {
    setRequest(initial);
    setReqBody(emptyBody);
    setResBody(emptyBody);
    setFetchedModal(null);
    setRawLoaded(false);
    setBodyError(null);
  }, [initial]);

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
  const reqTrunc = sectionTruncated(req, request.request_body_truncated);
  const resTrunc = sectionTruncated(res, request.response_body_truncated);
  const stub = stubLabel(request);

  useEffect(() => {
    let cancelled = false;
    setBodyError(null);
    const reqSection = asRecord((request.payload ?? {}).request);
    const resSection = asRecord((request.payload ?? {}).response);
    const skipReq = sectionTruncated(reqSection, request.request_body_truncated);
    const skipRes = sectionTruncated(resSection, request.response_body_truncated);

    (async () => {
      try {
        const tasks: Promise<void>[] = [];
        if (!skipReq) {
          tasks.push(
            decodeWireMockBodyFull(reqSection).then((rb) => {
              if (!cancelled) setReqBody(rb);
            }),
          );
        } else if (!cancelled) {
          setReqBody(emptyBody);
        }
        if (!skipRes) {
          tasks.push(
            decodeWireMockBodyFull(resSection).then((sb) => {
              if (!cancelled) setResBody(sb);
            }),
          );
        } else if (!cancelled) {
          setResBody(emptyBody);
        }
        await Promise.all(tasks);
      } catch (err) {
        if (!cancelled) setBodyError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  async function fetchFullBody(part: BodyPart) {
    setFetchingPart(part);
    setBodyError(null);
    try {
      const full = await api.getRequest(request.id, true);
      setRequest(full);
      const section = asRecord((full.payload ?? {})[part]);
      const decoded = await decodeWireMockBodyFull(section);
      if (part === "request") setReqBody(decoded);
      else setResBody(decoded);
      setFetchedModal({
        title: `${part} body`,
        value: decoded.text || decoded.bytes,
      });
      setRawLoaded(true);
    } catch (err) {
      setBodyError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingPart(null);
    }
  }

  async function ensureRawPayload() {
    if (rawLoaded && !reqTrunc && !resTrunc) return;
    if (!reqTrunc && !resTrunc) {
      setRawLoaded(true);
      return;
    }
    setRawFetching(true);
    setBodyError(null);
    try {
      const full = await api.getRequest(request.id, true);
      setRequest(full);
      setRawLoaded(true);
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
                  truncated={reqTrunc}
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
                  truncated={resTrunc}
                  truncatedSize={sectionSize(res)}
                  fetching={fetchingPart === "response"}
                  onFetchClick={() => void fetchFullBody("response")}
                />
              </section>
            </div>
          ) : rawFetching ? (
            <p className="muted">Loading full payload…</p>
          ) : (
            <pre className="json-body raw-json">{JSON.stringify(payload, null, 2)}</pre>
          )}
        </div>
      </div>

      {fetchedModal && (
        <PropertyValueModal
          title={fetchedModal.title}
          value={
            typeof fetchedModal.value === "string"
              ? fetchedModal.value
              : fetchedModal.value instanceof Uint8Array
                ? new TextDecoder().decode(fetchedModal.value)
                : fetchedModal.value
          }
          onClose={() => setFetchedModal(null)}
        />
      )}
    </div>
  );
}
