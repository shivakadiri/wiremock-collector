import { ReactNode, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import {
  BodyFormat,
  asString,
  formatAsJson,
  formatAsMarkdownSource,
  isNestableValue,
  previewValue,
  unwrapJsonValue,
} from "../lib/format";
import JsonArrayTable from "./JsonArrayTable";

type Props = {
  title: string;
  value: unknown;
  /** When set, treat as file bytes for download/view */
  file?: {
    filename: string;
    contentType?: string;
    bytes: Uint8Array;
  };
  onClose: () => void;
};

type Crumb = { label: string; value: unknown };

function isImage(ct?: string, filename?: string): boolean {
  if (ct && ct.startsWith("image/")) return true;
  return Boolean(filename && /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename));
}

function isTextual(ct?: string, filename?: string): boolean {
  if (!ct && !filename) return true;
  if (ct && (/^text\//i.test(ct) || /json|xml|javascript|csv|markdown|svg/i.test(ct))) return true;
  return Boolean(filename && /\.(txt|json|md|csv|xml|html?|js|ts|css|svg|log)$/i.test(filename));
}

function listEntries(value: unknown): { key: string; value: unknown }[] {
  const unwrapped = unwrapJsonValue(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map((v, i) => ({ key: `[${i}]`, value: v }));
  }
  if (unwrapped !== null && typeof unwrapped === "object") {
    return Object.entries(unwrapped as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }));
  }
  return [];
}

export default function PropertyValueModal({ title, value, file, onClose }: Props) {
  const [format, setFormat] = useState<BodyFormat>("json");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [stack, setStack] = useState<Crumb[]>([{ label: title, value }]);

  useEffect(() => {
    setStack([{ label: title, value }]);
  }, [title, value]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!file) return;
    const blob = new Blob([file.bytes], { type: file.contentType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const current = stack[stack.length - 1]?.value;
  const displayValue = useMemo(() => unwrapJsonValue(current), [current]);
  const entries = useMemo(() => listEntries(current), [current]);
  const isArrayView = !file && Array.isArray(displayValue);
  const showObjectTree =
    !file && !isArrayView && entries.length > 0 && displayValue !== null && typeof displayValue === "object";
  const showStructured = isArrayView || showObjectTree;

  const text = asString(displayValue);
  const jsonView = useMemo(() => formatAsJson(displayValue), [displayValue]);
  const markdownHtml = useMemo(() => {
    const src = formatAsMarkdownSource(displayValue);
    if (!src) return "";
    return marked.parse(src, { async: false, breaks: true }) as string;
  }, [displayValue]);

  function download() {
    if (!file || !objectUrl) return;
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = file.filename || "download";
    a.click();
  }

  function drillTo(key: string, child: unknown) {
    setStack((prev) => [...prev, { label: key, value: child }]);
    setFormat("json");
  }

  function jumpTo(index: number) {
    setStack((prev) => prev.slice(0, index + 1));
  }

  const showFilePreview = Boolean(file && objectUrl);
  const image = file ? isImage(file.contentType, file.filename) : false;
  const textualFile = file ? isTextual(file.contentType, file.filename) : false;

  function renderLeafView(): ReactNode {
    if (format === "markdown") {
      return <div className="markdown-body full-md" dangerouslySetInnerHTML={{ __html: markdownHtml }} />;
    }
    return (
      <pre className={format === "json" ? "json-body raw-json" : "text-body raw-json"}>
        {format === "json" ? jsonView : text}
      </pre>
    );
  }

  return (
    <div className="modal-backdrop nested-backdrop" onClick={onClose} role="presentation">
      <div className="modal-panel property-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2 className="mono">{stack.map((c) => c.label).join(" › ")}</h2>
            {file && (
              <p className="muted small">
                {file.filename} · {file.contentType || "application/octet-stream"} · {file.bytes.length} bytes
              </p>
            )}
            {!file && typeof current === "string" && current !== displayValue && (
              <p className="muted small">Decoded nested JSON string</p>
            )}
            {!file && isArrayView && (
              <p className="muted small">Array · {(displayValue as unknown[]).length} rows</p>
            )}
          </div>
          <div className="modal-header-actions">
            {file && (
              <button type="button" className="ghost" onClick={download}>
                Download
              </button>
            )}
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {!file && stack.length > 1 && (
          <nav className="crumb-bar" aria-label="Property path">
            {stack.map((c, i) => (
              <span key={`${c.label}-${i}`}>
                {i > 0 && <span className="crumb-sep">›</span>}
                <button
                  type="button"
                  className={`linkish crumb ${i === stack.length - 1 ? "current" : ""}`}
                  onClick={() => jumpTo(i)}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        )}

        {!file && (
          <div className="modal-tabs">
            {(["json", "markdown", "text"] as BodyFormat[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`ghost compact ${format === f ? "active-format" : ""}`}
                onClick={() => setFormat(f)}
              >
                {f}
              </button>
            ))}
            {showStructured && format === "json" && (
              <span className="muted small tab-hint">
                {isArrayView ? "Click a row to drill down" : "Click a property to drill down"}
              </span>
            )}
          </div>
        )}

        <div className="modal-body">
          {showFilePreview && image && objectUrl && (
            <div className="file-preview">
              <img src={objectUrl} alt={file?.filename || "file"} />
            </div>
          )}
          {showFilePreview && !image && textualFile && file && (
            <>
              <div className="modal-tabs">
                {(["json", "markdown", "text"] as BodyFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`ghost compact ${format === f ? "active-format" : ""}`}
                    onClick={() => setFormat(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {format === "markdown" ? (
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(formatAsMarkdownSource(new TextDecoder().decode(file.bytes)), {
                      async: false,
                      breaks: true,
                    }) as string,
                  }}
                />
              ) : (
                <pre className={format === "json" ? "json-body raw-json" : "text-body raw-json"}>
                  {format === "json"
                    ? formatAsJson(new TextDecoder().decode(file.bytes))
                    : new TextDecoder().decode(file.bytes)}
                </pre>
              )}
            </>
          )}
          {showFilePreview && !image && !textualFile && (
            <p className="muted">Binary file — use Download to save, or open after download.</p>
          )}
          {!file && showStructured && format === "json" ? (
            isArrayView ? (
              <JsonArrayTable
                items={displayValue as unknown[]}
                className="modal-prop-table"
                onSelectRow={(index, rowValue) => drillTo(`[${index}]`, rowValue)}
              />
            ) : (
              <div className="table-wrap flat prop-table modal-prop-table">
                <table>
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((row) => {
                      const preview = previewValue(row.value);
                      const nestable = isNestableValue(row.value);
                      return (
                        <tr key={row.key}>
                          <td className="prop-key mono">
                            <button type="button" className="linkish" onClick={() => drillTo(row.key, row.value)}>
                              {row.key}
                            </button>
                            <span className="pill muted-pill">{preview.kind}</span>
                            {nestable && <span className="pill muted-pill">drill</span>}
                          </td>
                          <td className="prop-val mono">
                            <button
                              type="button"
                              className="linkish val-btn"
                              onClick={() => drillTo(row.key, row.value)}
                            >
                              {preview.text}
                              {preview.truncated && <span className="pill muted-pill">truncated</span>}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            !file && renderLeafView()
          )}
        </div>
      </div>
    </div>
  );
}
