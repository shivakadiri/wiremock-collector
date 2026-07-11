import { ReactNode, useMemo, useState } from "react";
import { marked } from "marked";
import {
  BodyFormat,
  asString,
  childrenOf,
  formatAsJson,
  formatAsMarkdownSource,
  isNestableValue,
  previewValue,
  tryParseJson,
} from "../lib/format";
import { isMultipartContentType, parseMultipartBytes, MultipartPart } from "../lib/multipart";
import JsonArrayTable from "./JsonArrayTable";
import PropertyValueModal from "./PropertyValueModal";

type Props = {
  label: string;
  raw: unknown;
  bytes?: Uint8Array | null;
  contentType?: string;
  defaultFormat?: BodyFormat;
  /** Large body omitted from list payload — click to fetch */
  truncated?: boolean;
  truncatedSize?: number;
  fetching?: boolean;
  onFetchClick?: () => void;
};

type Selection =
  | { kind: "property"; path: string; value: unknown }
  | { kind: "file"; part: MultipartPart }
  | { kind: "root" };

function listProperties(value: unknown, prefix = ""): { path: string; key: string; value: unknown }[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((v, i) => ({
      path: prefix ? `${prefix}[${i}]` : `[${i}]`,
      key: `[${i}]`,
      value: v,
    }));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
      path: prefix ? `${prefix}.${k}` : k,
      key: k,
      value: v,
    }));
  }
  return [];
}

export default function BodyViewer({
  label,
  raw,
  bytes,
  contentType = "",
  defaultFormat = "json",
  truncated = false,
  truncatedSize,
  fetching = false,
  onFetchClick,
}: Props) {
  const [format, setFormat] = useState<BodyFormat>(defaultFormat);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState<Selection | null>(null);

  const parsed = useMemo(() => {
    if (typeof raw === "string") return tryParseJson(raw) ?? raw;
    return raw;
  }, [raw]);

  const multipartParts = useMemo(() => {
    if (!bytes || !isMultipartContentType(contentType)) return null;
    return parseMultipartBytes(bytes, contentType);
  }, [bytes, contentType]);

  const isJsonTree =
    !multipartParts && parsed !== null && typeof parsed === "object";

  const text = asString(raw);
  const empty = !truncated && !text && !multipartParts?.length;

  const jsonView = useMemo(() => formatAsJson(raw), [raw]);
  const markdownHtml = useMemo(() => {
    const src = formatAsMarkdownSource(raw);
    if (!src) return "";
    return marked.parse(src, { async: false, breaks: true }) as string;
  }, [raw]);

  function toggleExpand(path: string) {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function renderPropertyRows(value: unknown, prefix = "", depth = 0): ReactNode[] {
    const rows = listProperties(value, prefix);
    const nodes: ReactNode[] = [];
    for (const row of rows) {
      const preview = previewValue(row.value);
      const nestable = isNestableValue(row.value);
      const childRoot = nestable ? childrenOf(row.value) : null;
      const open = Boolean(expanded[row.path]);
      nodes.push(
        <tr key={row.path} className="prop-row">
          <td className="prop-key mono" style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}>
            {nestable && (
              <button type="button" className="ghost compact expand-btn" onClick={() => toggleExpand(row.path)}>
                {open ? "▾" : "▸"}
              </button>
            )}
            <button
              type="button"
              className="linkish"
              onClick={() => setSelection({ kind: "property", path: row.path, value: row.value })}
              title="Open full value"
            >
              {row.key}
            </button>
            <span className="pill muted-pill">{preview.kind}</span>
          </td>
          <td className="prop-val mono">
            <button
              type="button"
              className="linkish val-btn"
              onClick={() => setSelection({ kind: "property", path: row.path, value: row.value })}
            >
              {preview.text}
              {preview.truncated && <span className="pill muted-pill">truncated</span>}
            </button>
          </td>
        </tr>,
      );
      if (nestable && open && childRoot != null) {
        if (Array.isArray(childRoot)) {
          nodes.push(
            <tr key={`${row.path}__array`} className="prop-row array-embed-row">
              <td colSpan={2} style={{ paddingLeft: `${0.5 + (depth + 1) * 0.9}rem` }}>
                <JsonArrayTable
                  items={childRoot}
                  onSelectRow={(index, rowValue) =>
                    setSelection({
                      kind: "property",
                      path: `${row.path}[${index}]`,
                      value: rowValue,
                    })
                  }
                />
              </td>
            </tr>,
          );
        } else {
          nodes.push(...renderPropertyRows(childRoot, row.path, depth + 1));
        }
      }
    }
    return nodes;
  }

  if (truncated) {
    const sizeLabel =
      truncatedSize != null ? ` · ~${truncatedSize.toLocaleString()} bytes` : "";
    return (
      <div className="body-viewer">
        <div className="body-viewer-header">
          <strong>{label}</strong>
        </div>
        <button
          type="button"
          className="truncated-fetch linkish"
          onClick={onFetchClick}
          disabled={fetching || !onFetchClick}
        >
          {fetching ? "Fetching body…" : `[Truncated-Click to Fetch]${sizeLabel}`}
        </button>
      </div>
    );
  }

  return (
    <div className="body-viewer">
      <div className="body-viewer-header">
        <strong>{label}</strong>
        <div className="format-toggle" role="group" aria-label={`${label} format`}>
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
          <button type="button" className="ghost compact" onClick={() => setSelection({ kind: "root" })}>
            Full
          </button>
        </div>
      </div>

      {empty ? (
        <p className="muted small">Empty body</p>
      ) : multipartParts ? (
        <div className="table-wrap flat multipart-table">
          <table>
            <thead>
              <tr>
                <th>Part</th>
                <th>Type</th>
                <th>Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {multipartParts.map((part, idx) => (
                <tr key={`${part.name}-${idx}`}>
                  <td className="mono">
                    {part.name}
                    {part.isFile && part.filename && (
                      <div className="muted small">file: {part.filename}</div>
                    )}
                  </td>
                  <td className="muted small">{part.contentType || (part.isFile ? "file" : "text")}</td>
                  <td className="mono">
                    {part.isFile ? (
                      <span className="pill method">{part.filename || "file"}</span>
                    ) : (
                      (() => {
                        const p = previewValue(part.text ?? "");
                        return (
                          <button
                            type="button"
                            className="linkish val-btn"
                            onClick={() => setSelection({ kind: "property", path: part.name, value: part.text })}
                          >
                            {p.text}
                            {p.truncated && <span className="pill muted-pill">truncated</span>}
                          </button>
                        );
                      })()
                    )}
                    <div className="muted small">{part.size} bytes</div>
                  </td>
                  <td className="actions">
                    {part.isFile && part.bytes ? (
                      <>
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => setSelection({ kind: "file", part })}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => {
                            const blob = new Blob([part.bytes!], {
                              type: part.contentType || "application/octet-stream",
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = part.filename || part.name || "download";
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          Download
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => setSelection({ kind: "property", path: part.name, value: part.text })}
                      >
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isJsonTree && format === "json" ? (
        Array.isArray(parsed) ? (
          <JsonArrayTable
            items={parsed}
            onSelectRow={(index, rowValue) =>
              setSelection({ kind: "property", path: `[${index}]`, value: rowValue })
            }
          />
        ) : (
          <div className="table-wrap flat prop-table">
            <table>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>{renderPropertyRows(parsed)}</tbody>
            </table>
          </div>
        )
      ) : format === "markdown" ? (
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
      ) : (
        <pre className={format === "json" ? "json-body" : "text-body"}>
          {format === "json" ? jsonView : text}
        </pre>
      )}

      {selection?.kind === "property" && (
        <PropertyValueModal
          title={selection.path}
          value={selection.value}
          onClose={() => setSelection(null)}
        />
      )}
      {selection?.kind === "root" && (
        <PropertyValueModal title={label} value={parsed} onClose={() => setSelection(null)} />
      )}
      {selection?.kind === "file" && selection.part.bytes && (
        <PropertyValueModal
          title={selection.part.name}
          value={selection.part.filename || selection.part.name}
          file={{
            filename: selection.part.filename || selection.part.name,
            contentType: selection.part.contentType,
            bytes: selection.part.bytes,
          }}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
