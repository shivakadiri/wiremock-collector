import { previewValue, truncateText, unwrapJsonValue } from "../lib/format";

export type ArrayTableColumn = {
  key: string;
  label: string;
};

export type ArrayTableModel = {
  columns: ArrayTableColumn[];
  rows: {
    index: number;
    label: string;
    value: unknown;
    cells: Record<string, { text: string; truncated: boolean }>;
  }[];
  /** True when items are mostly objects with shared keys */
  objectRows: boolean;
};

const MAX_COLUMNS = 12;
const CELL_LIMIT = 80;

function cellText(value: unknown): { text: string; truncated: boolean } {
  if (value === null) return { text: "null", truncated: false };
  if (value === undefined) return { text: "", truncated: false };
  if (typeof value === "boolean" || typeof value === "number") {
    return { text: String(value), truncated: false };
  }
  if (typeof value === "string") {
    const unwrapped = unwrapJsonValue(value);
    if (unwrapped !== value && unwrapped !== null && typeof unwrapped === "object") {
      return truncateText(JSON.stringify(unwrapped), CELL_LIMIT);
    }
    return truncateText(value, CELL_LIMIT);
  }
  if (typeof value === "object") {
    return truncateText(JSON.stringify(value), CELL_LIMIT);
  }
  return truncateText(String(value), CELL_LIMIT);
}

/** Build a tabular model for a JSON array (object rows → columns from keys). */
export function buildArrayTable(items: unknown[]): ArrayTableModel {
  const objectCount = items.filter((v) => v !== null && typeof v === "object" && !Array.isArray(v)).length;
  const objectRows = objectCount > 0 && objectCount >= items.length * 0.5;

  if (!objectRows) {
    return {
      objectRows: false,
      columns: [
        { key: "#", label: "#" },
        { key: "value", label: "value" },
        { key: "type", label: "type" },
      ],
      rows: items.map((value, index) => {
        const preview = previewValue(value);
        return {
          index,
          label: `[${index}]`,
          value,
          cells: {
            "#": { text: String(index), truncated: false },
            value: truncateText(preview.text, CELL_LIMIT),
            type: { text: preview.kind, truncated: false },
          },
        };
      }),
    };
  }

  const keyCounts = new Map<string, number>();
  for (const item of items) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const k of Object.keys(item as object)) {
        keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
      }
    }
  }
  const sortedKeys = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
    .slice(0, MAX_COLUMNS);

  const columns: ArrayTableColumn[] = [
    { key: "#", label: "#" },
    ...sortedKeys.map((k) => ({ key: k, label: k })),
  ];

  const rows = items.map((value, index) => {
    const cells: Record<string, { text: string; truncated: boolean }> = {
      "#": { text: String(index), truncated: false },
    };
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      for (const k of sortedKeys) {
        cells[k] = k in obj ? cellText(obj[k]) : { text: "", truncated: false };
      }
    } else {
      // Mixed array: put preview in first data column
      if (sortedKeys[0]) {
        cells[sortedKeys[0]] = cellText(value);
      }
    }
    return { index, label: `[${index}]`, value, cells };
  });

  return { columns, rows, objectRows: true };
}
