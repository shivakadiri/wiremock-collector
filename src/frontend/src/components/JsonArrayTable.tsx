import { buildArrayTable } from "../lib/arrayTable";

type Props = {
  items: unknown[];
  onSelectRow: (index: number, value: unknown) => void;
  className?: string;
};

export default function JsonArrayTable({ items, onSelectRow, className = "" }: Props) {
  const model = buildArrayTable(items);

  if (!items.length) {
    return <p className="muted small">Empty array</p>;
  }

  return (
    <div className={`table-wrap flat array-table ${className}`.trim()}>
      <table>
        <thead>
          <tr>
            {model.columns.map((col) => (
              <th key={col.key} className={col.key === "#" ? "col-index" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr
              key={row.index}
              className="array-row clickable-row"
              onClick={() => onSelectRow(row.index, row.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRow(row.index, row.value);
                }
              }}
              tabIndex={0}
              role="button"
              title={`Open ${row.label}`}
            >
              {model.columns.map((col) => {
                const cell = row.cells[col.key] ?? { text: "", truncated: false };
                return (
                  <td key={col.key} className={`mono ${col.key === "#" ? "col-index" : "array-cell"}`}>
                    {cell.text}
                    {cell.truncated && <span className="pill muted-pill">…</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small array-hint">Click a row to drill down · {items.length} item{items.length === 1 ? "" : "s"}</p>
    </div>
  );
}
